# PROJECT SYMBOL REGISTRY — 项目符号注册表（防幻觉重命名/重复实现）

> 本文件是项目的**唯一权威命名清单**。任何后续编码，在新建或重命名函数/常量/类型/类/变量前，**必须**先 grep 本清单与代码库；已有符号一律复用，禁止因上下文丢失而重命名或重复造轮子。
> 强制流程见文末第 9 节。最后审计: 2026-09-12（初始登记，依据根目录 CONTEXT.md / docs/README.md / 代码实况）

---

## 1. 冲突与注意事项（先读）

- 本项目**没有** HTTP 后端，因此**不存在** `app/api/`、Server Actions、DB 表、storage bucket —— 旧模板小节已删除。边界契约见 `API_Design.md`。
- 领域词汇的**定义**以根目录 `CONTEXT.md` 为准，本表只登记符号名与位置，不重复定义。
- 术语命名必须使用 `docs/README.md` 词汇节（VEK / KEK / DEK / Slot / primary unlock method）与根目录 CONTEXT.md 的模块级词汇，禁止造同义新词（如把 VEK 叫 "masterKey"）。

**通用规则**：遇到需要以下已有语义时，先在此表与代码库检索，复用既有符号，禁止再造同义函数。

---

## 2. 环境变量（.env.local，仅供脚本读取）

| 变量 | 用途 |
|---|---|
| `DEEPSEEK_API_KEY` | i18n 翻译脚本（DeepSeek） |
| `I18N_MODEL` / `I18N_API_BASE` / `OLLAMA_HOST` / `I18N_CHUNK` | 翻译管线可选项 |
| `APPLE_SIGNING_IDENTITY` / `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` | macOS 签名与公证 |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `VAUTIX_APT_GPG_KEY` / `CF_ZONE_ID` / `CF_CACHE_PURGE_TOKEN` | APT 发布通道 |

规则：禁止新增 env 变量名时不更新本节；禁止改 `package.json` scripts 名（它们是对 AI 与 CI 的契约）。

---

## 3. 核心领域层（packages/core/src/vault/ 等）— 唯一权威符号

| 符号 | 位置 | 语义（唯一入口） |
|---|---|---|
| `VaultEntries` | 类型：`{ entries, stamps, tombstones }` | vault 条目状态三元组，不可拆成三个独立值 |
| `EntryMutations` | `core/vault/entry-mutations.ts` | 一切本地写操作唯一入口（add / update / remove / importMany / removeMany / setArchived / restore） |
| `entryDataSchema` | entry-mutations 模块 | `EntryData` 校验唯一关卡（加密前） |
| `EntriesBlobStore` / `writeEntriesBlob` / `readEntriesPayload` | `core/vault/entries-blob.ts` | adapter 上下文磁盘格式唯一读写者 |
| `normalizeTags` / `tagKey` / `allTags` | `core/vault/tags.ts` | 标签规范化 / 比较 / 词表唯一入口 |
| `PortableVault`（VLT1）: `seal_portable_vault` / `open_portable_vault` | core-rust 导出，`core/export/portable-vault.ts` 装框 | 加密导出文件唯一封/启路径 |
| `createVaultSyncPort` | `core/sync/apply-remote.ts` | 远程合并 → 写盘的唯一端口构造 |

---

## 4. 加密与 wasm 边界（改前必须用户确认）

| 符号 | 位置 | 语义 |
|---|---|---|
| `VaultCrypto` | `core/wasm.ts` | wasm 加密接口唯一声明 |
| `buildCryptoAdapter` | `core/adapters/crypto-wasm.ts` | 接口→wasm 调用唯一映射，所有传输共享 |
| wasm 导出（`seal_portable_vault` 等） | `core-rust/src/lib.rs` | 命名 = 跨语言契约，改名即破坏三端 |

---

## 5. 数据 / 同步不变式符号

| 符号 | 位置 | 语义 |
|---|---|---|
| `PREF_SCOPE` | `core/hooks/usePrefs.tsx` | 偏好作用域穷举表（device/vault），新增 Pref 必须登记 scope，编译器强制 |
| `syncKeyFor` | 存储层 | vault-scoped 键格式 `<key>:<vaultId>` 的唯一构造处 |
| `BulkAction` 及 `isAvailable` / `isEnabled` | `core/app/bulk-actions/`（index.ts 注册） | 批量操作唯一注册点 |
| dev flags | `core/flags.json` + `core/flags.ts` | 开发旗标唯一清单（rosterRequireSignatures / rosterRequireAdmission / rotateVaultSecret） |

---

## 6. UI 层（packages/core/src/app/）

| 类别 | 规则 |
|---|---|
| `components/ui/*`（button、text-field、password-field、modal、confirm-dialog、select-field、text-area、toast、checkbox、dropdown-menu、range-field、secret-text、secret-area、field-outline、password-strength-meter…） | **基元白名单**。写 UI 先复用；缺基元先扩展现有文件，禁止在 route/screen 里内联重写一个平行版本 |
| `routes/*Route.tsx` | 路由组件命名模式 `XxxRoute`，新路由跟随 |
| `screens/<Name>/<Name>.tsx` | 屏幕目录模式，新屏跟随 |
| `BulkAction` 对话框 | 每个批量操作自带 dialog，禁止加"立即执行无确认"路径 |

---

## 7. 自动填充检测（platform-extension/content）

| 符号 | 位置 | 语义 |
|---|---|---|
| `PageFieldModel` / `parsePageFields` | `content/detection.ts` | 页面字段模型唯一解析入口（含缓存） |
| `PageScan` / `createScan` | 同上 | 唯一 DOM 收集（DFS 前序），各检测档依赖同一顺序 |
| `detectLoginFields` | 检测档实现 | 登录字段检测唯一入口 |
| `splitOtpFields` / `candidateKind` | 检测/填充模块 | OTP 盒子 vs mirror 区分 / 元素候选判定 |

---

## 8. 平台端命名模式（跟随，勿自创）

- 扩展：`offscreen-*.ts`（offscreen 任务）、`background/`、`content/`、`platform-api.ts`（平台 API 唯一抽象）。
- 移动：`adapters/`（原生桥实现）、`native-crypto.ts`、`secure-storage.ts`。
- 桌面：`src-tauri/`（Rust）、`sync-crypto.ts`、`spotlight.tsx`。
- IPC/消息类型：定义在各端唯一处，命名即契约（见 `API_Design.md`）。

---

## 9. 使用此清单的强制流程（对 AI）

1. **写新代码前**：grep 本文件相关关键词 + 全库检索，确认无既有符号可用；有则复用。
2. **已有功能 = 禁止重复实现**：写 vault 走 `EntryMutations`；标签走 `normalizeTags`；偏好走 `PREF_SCOPE`/`usePrefs`；加密走 `VaultCrypto`/`buildCryptoAdapter`；导出走 `PortableVault`；批量操作走 `BulkAction` 注册。
3. **禁止**：重命名本表任一符号、改 wasm 导出名、改 env 变量名、改 `package.json` scripts 名、改 dev flags 键名 —— 除非用户明确要求，并同步更新本表与所有引用。
4. **新增符号**：命名遵循同模块既有风格；确认保留后**必须**追加登记到本表对应小节（这是 AI 的收尾步骤之一，遗漏视为任务未完成）。
5. **发现未登记的既有符号**：不要当作"可随意改"的证据 —— 先登记，再谈修改。
