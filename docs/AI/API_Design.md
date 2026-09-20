# API_Design.md — 接口契约与变更守则（Vaultix / Vautix）

> **定位（先读）**：本项目是本地优先的密码管理器（扩展/移动/桌面 + Rust 核心），**没有自建 HTTP 后端、没有 REST/GraphQL API、没有数据库**。
> 旧模板的"后端 API 设计"小节不适用，已删除。本项目真正存在、且 AI 必须当作"API 契约"对待的边界是下面这些。
> 如果未来真的要加在线服务（如 cloud-storage-backups 的 S3/WebDAV 只是客户端对接第三方），对接代码遵循第 6 节。

---

## 1. 本项目的"API"= 跨边界契约清单

| 契约 | 定义处 | 消费方 | 破坏后果 |
|---|---|---|---|
| wasm 导出函数（`VaultCrypto` 面） | `core-rust/src/lib.rs` 导出 + `core/wasm.ts` 声明 | 扩展 / 移动 / 桌面 全部 JS 侧 | 三端同时崩 |
| uniffi FFI 接口 | `core-rust`（`uniffi-bindgen.rs`）+ `ffi:bindings` 产物 | iOS / Android 原生层 | 移动双端崩 |
| 磁盘 vault 格式（VLT1 v2） | `docs/vault-format.md` + `core/vault-format.ts` / `entries-blob.ts` | 用户已存数据 | 用户数据不可读，**不可逆** |
| 便携导出文件（VLT1） | `seal_portable_vault` / `open_portable_vault` + `core/export/portable-vault.ts` | 跨设备交换 | 旧导出文件打不开 |
| 同步合并语义（HLC + tombstones） | `core/sync/`，词汇见根目录 CONTEXT.md | 所有多设备用户 | 合并冲突、数据丢失 |
| 浏览器消息通道（background↔content↔popup↔offscreen） | `platform-extension/src/`（sender / offscreen-core 等） | 扩展内部 | 自动填充失效 |
| 桌面↔浏览器桥（native messaging） | `platform-desktop` + `platform-extension/desktop-link.ts` | 配对功能 | 配对断连 |
| Adapter 接口（存储/加密/原生桥） | `core/src/adapters/` 接口 + 各 platform 实现 | 核心与平台解耦 | 平台实现静默失配 |
| 第三方对接（S3/WebDAV、Addy.io/SimpleLogin、Nostr 中继） | 各自 feature 模块 + `docs/` 对应设计文档 | 对应功能 | 该功能失效 |
| `package.json` scripts 名 | 各 package.json | AI / CI / 发布脚本 | 流水线断 |

## 2. 设计原则（新增跨边界接口时）

- **单一实现**：一个契约只允许一个实现/写入者；确需第二个（如扩展 background 的独立传输），必须像根目录 CONTEXT.md 记录那样写明理由，禁止静默增加。
- **纯 TS 侧装框，加密进 Rust**：容器/格式装框逻辑留在 TypeScript（VLT1 模式），密码学原语一律在 core-rust。新接口不得打破这条线。
- **显式版本化**：磁盘/文件格式字段用 TLV 等可扩展编码（沿用 vault-format.md 的做法），新字段必须可被旧读取端跳过。
- **接口最小面**：adapter / wasm 只暴露功能需要的方法；不为"以后可能用"预导出。
- **命名即契约**：跨语言符号（wasm 导出、FFI、消息类型）命名后即冻结，改名走第 5 节流程。

## 3. 各契约的具体规则

### 3.1 wasm / FFI（core-rust 边界）
- 改 Rust 导出签名前：先确认 `core/wasm.ts` 的 `VaultCrypto` 声明与三端调用点；改动 = 三端联动。
- 改后必须：`pnpm wasm:build`（扩展/桌面）+ `pnpm wasm:build:mobile`（移动）重建产物，`pnpm wasm:test` + `pnpm wasm:verify` 验证；移动端还需 `pnpm ffi:build:ios|android`。
- 禁止在 TS 侧补一个"等价实现"绕过 Rust（即使是浅校验）——加密边界只有 Rust 一侧。

### 3.2 磁盘/文件格式
- **兼容性是红线**：任何让旧版本应用读不了新数据、或新版本丢数据的变化，禁止。
- 新增字段：可扩展编码 + 旧端跳过语义；改语义：需要显式版本 bump，必须用户确认。
- 修改后同步更新 `docs/vault-format.md`，格式文档与代码不许出现两个说法。

### 3.3 浏览器 / 桌面 IPC
- 消息类型集中定义（现在哪就留在哪），新增消息先检索是否已有同义消息。
- 消息 payload 走 zod 校验（core 已依赖 zod）或既有校验模式——来自 content script / 外部的输入是不可信输入。
- offscreen 写队列的原子性保证（见 `offscreen-atomicity.test.ts`）不许绕过。

### 3.4 Adapter 接口
- 新增能力：先在 `core/src/adapters/` 定义接口 + core 内的调用点，再在各 platform 实现并登记到 `PROJECT_SYMBOL_REGISTRY.md`。
- 禁止某个平台为了省事在业务代码里 `if (platform === 'mobile')` 直连实现。

## 4. 修改前检查清单（AI 必答）

1. 这次改动碰到上表哪几个契约？
2. 各消费方（三端 + 已存在用户数据）分别受什么影响？
3. 是否破坏向后兼容？——是则停止，报告用户。
4. 对应 `docs/` 设计文档是否需要同步更新？（文档与实现不同步视为改动未完成）

## 5. 变更流程（契约级改动）

1. **先报告**：说明契约、动机、影响面、迁移/兼容方案 —— 等用户确认，不许先改后报。
2. 用户确认后：一次性改齐 定义处 + 全部消费方 + 文档 + `PROJECT_SYMBOL_REGISTRY.md`，不留半成品提交点。
3. 跑全量验证：`pnpm typecheck && pnpm test`，涉及 rust 加 `pnpm wasm:test`，涉及端到端加对应 `test:e2e:*`。

## 6. 未来若引入自建后端

目前没有计划。若未来引入：先在本文件新增"HTTP API"小节定义路由命名、鉴权、错误码约定，再写代码；沿用本文档的单一契约与版本化原则；路由名进 `PROJECT_SYMBOL_REGISTRY.md`。
