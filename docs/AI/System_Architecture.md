# System_Architecture.md — 模块化架构守则（Vaultix / Vautix）

> **定位**：本项目**已经是**一个成型的框架/架构，本文档**不发明新架构、不新建框架**。
> 它的职责是：① 描述现状分层（AI 必须理解）；② 规定"往哪儿放代码"的模块化规则（AI 必须遵守）。
> 高层设计的"为什么"在 `docs/README.md` 的索引里，按主题查阅，不要在本文件重复。

---

## 1. 现状分层（事实描述，勿凭空重构）

```
┌─ surfaces（界面载体，薄壳）──────────────────────────┐
│ platform-extension  浏览器扩展 MV3（background/content/popup/offscreen）│
│ platform-mobile     Capacitor（iOS/Android 原生桥）                    │
│ platform-desktop    Tauri 2（src-tauri + spotlight + 桥接）           │
│ website             Astro 营销站（独立，不加载 core 业务）             │
├─ shared（平台无关核心）────────────────────────────────┐
│ core  业务逻辑 + 全部 UI（app/）+ 领域模块 + adapter 接口               │
│ core-rust  加密/协议原语（wasm 供 JS 侧；uniffi 供移动原生侧）          │
│ theme  设计 token 单一来源（纯 CSS）                                    │
└────────────────────────────────────────────────────────┘
```

**关键 seam（接缝，单一实现，勿破坏）**：

- **`core/src/adapters/`** — 平台差异的唯一注入点。核心通过接口调用能力（存储、加密、原生桥），各 platform 包提供实现。`buildCryptoAdapter`（`core/adapters/crypto-wasm.ts`）是加密 adapter 的唯一映射。
- **`core/wasm.ts` 的 `VaultCrypto`** — wasm 加密接口唯一声明处。
- **`core/vault/entry-mutations.ts`（EntryMutations）** — 对 VaultEntries 的一切本地写操作唯一入口。
- **`core/vault/entries-blob.ts`（EntriesBlobStore）** — adapter 上下文里磁盘 vault 格式的唯一读写者。
- **`core/wasm.ts` / `core-rust`** — 一切密码学只发生在 Rust 侧，TS 侧禁止手搓加密。
- 根目录 `CONTEXT.md` 的 "Vault scoping" 一节是**硬性不变式**：任何持久化值必须显式声明 device-scoped 或 vault-scoped。

## 2. 模块化编码规则（AI 必须遵守）

### 2.1 代码放哪儿（新代码归位表）

| 要写的代码 | 必须放 | 禁止放 |
|---|---|---|
| 领域逻辑 / 数据变换（纯函数） | `core/src/vault/`、`core/src/sync/`、`core/src/util/` 等对应领域目录 | platform 包、组件文件内 |
| React 组件 / 页面 | `core/src/app/`（routes/screens/components 已有分层） | `core/src/vault/` 等领域目录 |
| UI 基元（button/field/modal…） | `core/src/app/components/ui/`（先复用，已有的禁止另写） | 各 route 里内联重写 |
| 平台差异能力 | 接口进 `core/src/adapters/`，实现进对应 platform 包的 `adapters/` | 在业务代码里直接判平台（`if (isExtension)` 散落业务逻辑） |
| 加密 / 协议原语 | `core-rust`（Rust）+ `core/wasm.ts`（声明） | 任何 TS 文件里的自实现加密 |
| 设计 token | `packages/theme/theme.css` | 任何组件里的硬编码色值 |

### 2.2 依赖方向（唯一允许的方向）

- `platform-*` → `core` → `theme`。**禁止反向**（core 不得 import 任何 platform 包）。
- **禁止跨层直连**：platform 包只通过 core 的公开入口（`core/src/index.ts` 及显式导出）使用核心；不得深入 `core/src/vault/*.ts` 内部文件抓实现细节。
- `website` 不依赖 `core`（仅共享 `theme`）。
- 领域模块之间：单向依赖，出现环即视为设计错误，停下来报告而不是用 `any`/re-export 掩盖。

### 2.3 模块化纪律

- **单一写入者原则**：一个外部契约（磁盘格式、IPC 消息、wasm 接口）只允许一个实现/写入者。需要第二个实现时，必须先向用户论证（参考根目录 CONTEXT.md 对扩展 background 例外写入者的记录方式）。
- **改动最小面**：新增能力优先通过"注册进既有 descriptor/index"扩展（如 `app/bulk-actions/index.ts` 的 BulkAction 模式），而不是修改调用方代码。
- **新模块**：一个目录一个职责；目录名用现有词汇（见根目录 CONTEXT.md 领域词汇表），不造新词。
- **禁止的"顺手重构"**：改 bug 时不顺带迁移模块、不移动文件、不改目录结构 —— 除非用户明确要求。
- 新增跨 seam 的接口（adapter 方法、wasm 导出、IPC 消息类型）前：先查 `PROJECT_SYMBOL_REGISTRY.md` 确认无既有接口，再按 `API_Design.md` 的变更流程走。

## 3. 平台端备注（防 AI 踩坑）

- 扩展 background 与 adapter 上下文是**两套传输**（offscreen IPC + 写队列 vs EntriesBlobStore），是有意为之的双写入者，不要"统一"它们。
- 移动端加密走 uniffi FFI（`ffi:build:*`），桌面/扩展走 wasm（`wasm:build`）；改 core-rust 后两侧都要重建对应产物，并在说明里注明。
- Tauri 桌面端配置在 `platform-desktop/src-tauri/tauri.conf.json`，更新通道另有 `tauri.local-update.conf.json`，勿混淆。
