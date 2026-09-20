# Threat model — Vautix 统一威胁模型

- 日期: 2026-09-20
- 定位: 汇总性文档。它**不发明新防御**，只做三件事：画出信任边界与攻击面；把散落在 5 份安全审计（`sec-audit-*`）与 2 份硬化设计（`vek-residency-hardening.md`、`p2p-sync-revocation-hardening.md`）中的威胁、已修复项、已接受残余**汇总到一张表**；给出改动任何一块时必须复查的红线清单。细节与 file:line 证据以各源文档为准，本文件只保留结论与指针。
- 阅读前提: 密钥层级（VEK/KEK/DEK/Slot）见 [cryptography.md](cryptography.md)；同步信任模型见 [p2p-sync.md](p2p-sync.md)。

---

## 1. 资产与敌手

### 资产（按价值排序）

| 资产 | 说明 |
|---|---|
| 明文凭证 | 条目里的密码、API key、TOTP secret、passkey——一切防御的最终对象 |
| VEK | 解密 vault 的根密钥。拿到 VEK = 拿到全部历史明文 |
| KEK / slot 材料 | 主密码派生值、WebAuthn/HKDF 派生值、恢复码 |
| 恢复码 / 恢复 slot | 等价于 VEK 的第二扇门 |
| 同步身份（Noise 静态密钥、roster seed、Ed25519 sigKey） | 拿到可伪装成员接收同步流量 |
| 云备份凭证（S3/WebDAV） | 可读备份密文、可破坏备份 |

### 敌手模型（防谁）

| # | 敌手 | 能力 | 典型入口 |
|---|---|---|---|
| A | 本地窃取者 | 拿到磁盘/备份文件/云 bucket，无设备 root | vault 文件、`.vautix` 导出、云备份密文 |
| B | 恶意网页 | 任意 JS，运行在用户浏览的页面 | content script 邻居、iframe、点击劫持、导航竞争 |
| C | 同步对端（被攻陷的成员设备） | 持有该设备的 Noise 静态密钥 + roster seed，**无主密码/VEK** | roster gossip、mesh 消息 |
| D | 中继/基础设施 | 运行 Nostr relay / signaling / TURN，只见流量 | 元数据关联、时间分析（无明文） |
| E | 同机进程 | 以用户身份运行（无 root） | 内存/swap/转储、桌面 Linux Secret Service |
| F | 恶意输入文件 | 用户导入的 KDBX/CSV 等 | kdbx 解析器、导入器 |
| G | 观察配对过程的人 | 看到/拍到配对码或 QR | enrollment 窗口期 |

**明确不防**：已 root/越狱设备上的活跃读取者（密钥在内存中即可被读）；持主密码者（定义上即所有者）；对被攻陷渲染器的**破坏**行为（如删云备份——已接受，见 §4）；全盘加密缺失导致的无处不在磁盘取证。

---

## 2. 信任边界与攻击面

```
┌─ 不可信 ─────────────────────────────────────────────┐
│ 网页 DOM（B）、导入文件（F）、配对码旁观者（G）、中继（D）│
└──────────────┬───────────────────────────────────────┘
        边界①   content script  ← 唯一暴露在页面旁的代码
        边界②   浏览器 IPC（background ↔ content ↔ offscreen），消息一律 zod 校验
        边界③   offscreen crypto host：仅 target:"offscreen" + sender 门（A3 修复）
        边界④   Tauri 命令面：origin pin（backup_send 修复）、main-window-only
        边界⑤   Capacitor 插件桥（JSON 序列化 —— 跨界只能传字符串，见 VEK 残余）
        边界⑥   Noise KK/XXpsk3 握手：双向 pin 才算认证（enroll 修复后）
┌─ 可信 ──────────────────────────────────────────────┐
│ core-rust（唯一密码学实现，wasm/uniffi）+ 各端受信上下文  │
└──────────────────────────────────────────────────────┘
```

不变式（跨所有边界）：加密只在 Rust；TS 侧只装框；不可信输入进 Rust 前过 zod/schema（`entryDataSchema`、IPC payload、KDBX 参数天花板）；一切写入经 `EntryMutations` / `EntriesBlobStore` 单一写入者；vault scoping 硬性不变式（根目录 CONTEXT.md）。

---

## 3. 威胁→防御汇总表

| 威胁 | 边界/敌手 | 状态 | 防御与出处 |
|---|---|---|---|
| 磁盘/备份文件离线爆破 | A | ✅ 防御 | Argon2id（t=3, m=64MiB）+ AES-256-GCM，审计 4419"无 HIGH" |
| nonce/盐复用、静态密钥 | — | ✅ 防御 | 全部 CSPRNG 即用即生成，条目每次保存重随机化 DEK+IV（sec-audit-4419） |
| 恶意 KDBX 导入（F） | 边界②前 | ✅ 防御 | 有界游标、KDF 参数天花板、UUID 白名单、逐块 HMAC（kdbx.rs） |
| 签名/握手 fail-open | C | ⚠️ **已知开口** | 原语齐全但 enforcement 关闭：`rosterRequireSignatures/Admission = false`，`roster_verify` 可选 fail-open。phase-2 flip 前置条件见 revocation-hardening 的迁移时钟节 |
| 被攻陷成员注入 rogue/伪装设备 | C | ⚠️ 同上 | Item A（entry 签名 + admission）已产出未强制；future-stamp 守卫已关闭"永久不可撤销"变体 |
| 配对码=裸 bearer secret（G） | 边界⑥ | ✅ 已修复 | GHSA-x4f5：inviter 侧认证 + bundle 凭据收紧，breaking change 已随 1.11/1.8/0.9.8/1.4.3 发布。**残余：VEK 不可轮换，泄露发生在修复前则永久**（见 §4） |
| autofill 秘密投递到替换文档（B） | 边界① | ✅ 已修复 | GHSA-xm22：按发起 MessageSender 授权、响应只走发起通道、文档身份/epoch/lease 门，真实浏览器 CI 门 |
| 解锁/换 vault 竞态泄露明文缓存 | E/B | ✅ 已修复 | 解密索引绑定 vault 会话（opaque id+generation+token）；VEK 安装/移除事务化 fail-closed |
| 备份 confused-deputy 外泄凭证（E） | 边界④ | ✅ 已修复 | origin pin + main-window-only + userinfo/子域/端口测试矩阵（sec-audit-backups #1） |
| 跨 vault 快照互删 | — | ✅ 已修复 | vault-tagged 对象键 + 定域 pruning（sec-audit-backups #2） |
| VEK 跨越 JS 堆（E） | 边界⑤ | ⚠️ **已知残余** | Rust 侧全 `Zeroizing`，但 base64 字符串跨界不可擦除。5 项收敛清单在 vek-residency-hardening.md（#1–4 约 3 天，#5 enrollment 协议变更另议） |
| 中继元数据关联（D） | — | ⚠️ 已接受 | Item B（组密钥轮换）deferred；epoch 重协商成本 > 收益，见 revocation-hardening Phase 3 |
| Linux 同机进程读 Secret Service（E） | — | ⚠️ 已接受 | 无 per-app ACL，退路是全盘加密（sec-audit-backups） |
| 被攻陷渲染器破坏备份/读密文 | E | ⚠️ 已接受 | origin pin 挡外泄不挡滥用；"Keep everything" retention 让凭证无 DELETE 权限（S3/Dropbox 已闭，WebDAV 开） |
| 桌面密码学强度回退 | — | ✅ 防御 | KDF 参数不可由用户调低；slot-policy 统一管强度档位 |

---

## 4. 已接受残余（决策记录，勿当新发现重报）

1. **Roster enforcement 关闭**（medium，accepted-risk 状态）：flip 三前置见 [p2p-sync-revocation-hardening.md](p2p-sync-revocation-hardening.md)。
2. **VEK 的 JS/原生字符串副本**：平台桥不能传字节（chrome.runtime/Capacitor/WKWebView 均 JSON/plist），唯一彻底解是不跨界；按 hardening 清单逐项收敛，最终残余=扩展 per-op shipping（平台地板）。
3. **修复前泄露的 VEK 不可撤销**：无 VEK rotation；补救=更换 vault 内凭证，轮换主密码无效（recovery slots 存活）。
4. **被攻陷渲染器可滥用用户自己的备份凭证**（不外泄但可删）；WebDAV 应用密码无 scope，服务器不拒 DELETE 则敞开。
5. **中继可关联设备会话**（IP/socket 持久性）；组密钥轮换 deferred。
6. **绝对会话上限缺失**：自动锁为空闲重置 + Never；墙钟上限是产品决策，单独跟踪。

## 5. 改动红线（触碰对应区域前必查）

| 改动区域 | 必查 |
|---|---|
| core-rust 导出/签名 | `API_Design.md` §3.1 + 用户确认；`wasm:build`+`wasm:test`+`wasm:verify`，移动端 `ffi:build:*` |
| VLT1 磁盘/导出/roster wire 格式 | 兼容性红线 + 版本协商 + 五端矩阵；先报用户 |
| offscreen / background 消息 | sender 门不回退（A3 教训）；`offscreen-atomicity.test.ts` 不绕过 |
| autofill 投递路径 | GHSA-xm22 的 Security invariants 节逐条对照（授权只认 MessageSender；秘密不走 frame 广播） |
| backup_send / 桌面命令 | origin pin 测试矩阵不弱化；新命令默认 main-window-only |
| roster/merge | future-stamp 守卫与 `HLC_MAX_DRIFT_MS` 耦合（B4 教训：不许孤立调参） |
| VEK 生命周期 | vek-residency-hardening 的 inventory——不新增跨界副本 |
| 新 adapter/平台实现 | `PROJECT_SYMBOL_REGISTRY.md` 登记；vault-scoping 穷举（`PREF_SCOPE`） |

## 6. 持续验证

- 单测/集成：`pnpm test`（含 offscreen-atomicity、enroll-host 帧序、autofill 真实浏览器门）；rust：`pnpm wasm:test`。
- 依赖审计：CI 补 `cargo audit` / `pnpm audit`（当前缺口，跟踪中）。
- 渗透/复核节奏：重大协议或传输变更时做 adversarial review（方法见 sec-audit-backups 的 Method note：多透镜 finder + 怀疑者否证制）。
