# Audit log — 本地审计日志（PRD v0.2 `vautix_audit_log` 的零知识实现）

- 日期: 2026-09-20
- 状态: **已实现（第一阶段）**——核心模块 + unlock/lock/copy/export 四个最高价值挂点已落地并通过验证；autofill.fill / backup.run / device.enroll / device.revoke 挂点与设置页 Activity 面板为后续增量（见 §6 顺序），事件类型已预留。
- 定位: 记录"谁在何时对保险库做了敏感操作"。**本地加密存储，不外发**，与零知识架构一致：日志对中继、备份服务商、任何拿到密文的人都是不可读的。

---

## 1. 目标与非目标

**目标**
- 记录敏感事件：解锁（unlock 成功/失败）、密码/密钥查看（secret reveal）、导出（portable export）、自动填充提交、备份运行、VEK 轮换、设备加入/撤销。
- 静默写入：不弹窗、不打断操作（审计日志的写入路径绝不能成为主流程的故障点）。
- 用户可在设置中查看与清空。

**非目标**
- 不防拥有 VEK 的攻击者事后篡改日志（威胁模型 §1 已声明不防持主密码者）；日志防的是"被动旁观者"与"事后翻设备看明文"。
- 不同步到其他设备（第一版仅本机；跨设备审计是后续可选扩展，见 §7）。
- 不做防篡改链（hash-chain）——第一版可加每条记录的自洽 MAC（AEAD 天然提供），不做事后不可抵赖。

## 2. 事件模型

```ts
// packages/core/src/vault/audit-log.ts
type AuditEventKind =
	| "vault.unlock"        // 成功解锁（含方法：password/biometric/recovery）
	| "vault.unlockFailed"  // 失败尝试（只记原因类别，不记输入）
	| "vault.lock"
	| "secret.reveal"       // 查看密码/密钥/TOTP（记 entryId，不记明文）
	| "secret.copy"         // 复制到剪贴板
	| "entry.export"        // 便携导出 / CSV 导出
	| "autofill.fill"       // 自动填充（记 host，不记 URL 全路径）
	| "backup.run"          // 云备份（记 targetId + 成败）
	| "vault.vekRotate"
	| "device.enroll" | "device.revoke";

interface AuditEvent {
	kind: AuditEventKind;
	at: number;          // Date.now()
	entryId?: string;    // secret.* 时
	host?: string;       // autofill.fill 时（仅 hostname）
	method?: string;     // unlock 方式
	outcome?: "ok" | "fail";
}
```

红线：**事件里永不出现明文密码、密钥、URL 路径、输入的失败密码内容**。`entryId` 指向密文里的条目，日志读者若不能解密 vault 则 id 无意义——不额外泄漏条目名。

## 3. 存储与加密（vault-scoped）

- **键**：`audit.log:<vaultId>`（复用 `syncKeyFor` 的 `<key>:<vaultId>` 格式；vault scoping 硬性不变式——审计日志描述"某一个 vault"，必须 vault-scoped）。
- **载体**：`StorageAdapter.getMeta/setMeta`（各端已有实现，无 adapter 接口变更——**不触碰 API_Design 契约表**）。
- **加密**：每条事件独立 AEAD 封装（经 `CryptoAdapter`，密文 = 新随机 IV + AES-256-GCM；密钥从 VEK 经 HKDF 域分离派生 `vautix/audit/v1`，**不复用** entry DEK 体系，避免日志读写搅动 entries blob）。追加 = 读出数组 + append + 写回；条数上限 1000，超出丢最旧（FIFO），防无限膨胀。
- **写入时机**：fire-and-forget（`void appendAuditEvent(...)`，内部 catch-all 吞错并静默）——审计写入失败绝不影响业务操作本身；`vault.unlock` 事件在解锁路径**之后**追加，不在关键路径上。
- **锁定态**：VEK 不可用时写入降级为**丢弃并计数**（`audit.dropped` 明文计数器，只含数量不含内容），下次解锁时补记一条 "N events dropped while locked"。不缓冲明文事件等解锁——明文驻留违背最小暴露。

## 4. 写入点（全部走既有 seam，不新开写入者）

| 事件 | 挂载点 | 说明 |
|---|---|---|
| unlock/lock/vekRotate | 解锁门（`useVault` / slot-policy 成功回调处） | 解锁方法从现有 unlock 返回值取 |
| secret.reveal/copy | `secret-text` / `secret-area` 基元的 reveal 回调（**唯一收口**——这正是 Design_System §5 "涉密展示必须走基元"的红线带来的红利：挂两个基元就覆盖全部查看路径） | |
| autofill.fill | 扩展 background autofill 成功路径 | host 已有 hostnameMatches 产物 |
| entry.export | 导出流程（portable-vault.ts 调用方） | |
| backup.run | 备份 run 收尾处 | |
| enroll/revoke | `useSyncEnrollment` / `revokeDevice` | |

UI 读取：设置页新增 "活动记录"（Settings → Activity），仅展示已解密日志 + 清空按钮；i18n 文案走 Lingui，走基元白名单组件。

## 5. 兼容与风险自查（API_Design §4 必答）

1. **触碰的契约**：无。新存储键 + 新 core 模块，不动 wasm/FFI/磁盘 VLT1/IPC/adapter 接口。meta 键是新增，旧版本应用读不到即忽略——向后兼容。
2. **消费方影响**：三端共享 core，写入点全部在 core/共享 UI 层；扩展 background 的 autofill 事件经既有消息通道，无新消息类型。
3. **向后兼容**：是（纯新增，可被旧端跳过；清空/关闭功能不删除任何既有数据）。
4. **文档同步**：本文件即设计文档；实现时登记符号到 `PROJECT_SYMBOL_REGISTRY.md` §3/§5。

**已知权衡**：setMeta 整读整写（1000 条上限内可接受，审计写入频率低）；多上下文并发追加在扩展 offscreen 与 background 间可能丢个别事件（fire-and-forget 语义下可接受，审计不承诺零丢失——承诺"尽力记录"）。

## 6. 实现顺序（每步 ≤3 文件，各自验证）

1. `audit-log.ts` 核心（事件类型 + append/read/clear + HKDF 派生）+ 单测
2. 挂载 unlock/reveal/copy 三个最高价值写入点（vault + 基元）
3. 挂载 autofill/export/backup/enroll 写入点
4. 设置页 Activity 面板 + i18n extract
5. 收尾：符号登记、文档定稿、SESSION.md

## 7. 未来扩展（不承诺）

跨设备同步审计（经同一中继通道，密文合并需要各自签名防伪造——依赖 roster 签名体系）；hash-chain 防事后篡改。
