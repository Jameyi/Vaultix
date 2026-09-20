# CONTEXT.md — AI 协作环境与上下文协议（Vaultix / Vautix）

> **命名说明（先读）**：本项目有**两个** CONTEXT.md，职责不同，互不替代：
>
> | 文件 | 职责 |
> |---|---|
> | `/CONTEXT.md`（根目录） | 项目自带的**领域词汇表**（VaultEntries、EntryMutations、VEK/KEK/DEK、vault scoping 等）。这是**权威定义**，本文件不重复、不修改它。 |
> | `/docs/AI/CONTEXT.md`（本文件） | **AI 工作协议**：环境事实、命令、验证流程、行为约束。 |
>
> AI 在编码前必须先读根目录 CONTEXT.md 学习领域词汇，再读本文件了解怎么干活。两者命名相同是有意为之的分工约定；如需改名须用户确认。

---

## 1. 环境事实（不要凭记忆假设）

- **包管理器**：pnpm（`pnpm-workspace.yaml`），Node 生态，**没有 npm scripts 叫 `dev:reset` / `dev:health` / `dev:start`**——旧文档里的这些命令属于另一个项目，禁止执行。
- **Monorepo 结构**（pnpm-workspace 声明）：
  - `packages/theme` — 设计 token（纯 CSS，无构建步骤）
  - `packages/core` — 平台无关的业务与 UI（`@vault/core`）
  - `packages/core-rust` — Rust 加密核心（wasm + uniffi FFI）
  - `packages/platform-extension` — 浏览器扩展（MV3，Chrome/Firefox）
  - `packages/platform-mobile` — Capacitor 移动端（iOS/Android）
  - `packages/platform-desktop` — Tauri 2 桌面端
  - `website` — Astro 营销网站（Cloudflare Pages）
  - `nostr-relay/cf-worker` — 中继 Worker
- **没有自建后端服务器、没有数据库、没有 Redis**。旧模板里的 FastAPI/PostgreSQL/端口 3000/8000/5432/6379 一概与本项目无关。
- **代码风格**：Biome（`biome.json`），Git hooks 在 `.githooks/`。
- **敏感目录**：`packages/core-rust/`（加密实现）、`docs/vault-format.md` 对应的格式代码、`packages/*/src/adapters/`。改这些必须先说明理由。

## 2. 常用命令（以 package.json 为准，勿凭空捏造）

```bash
pnpm install              # 安装依赖
pnpm dev                  # 并行起 chrome/firefox/website 开发
pnpm dev:chrome / dev:firefox / dev:website / dev:desktop / mobile:dev
pnpm typecheck            # 全 workspace tsc --noEmit（改 TS 后必跑）
pnpm test                 # cargo test (core-rust) + 各包 vitest（改逻辑后必跑）
pnpm lint / pnpm ci:check # Biome 检查
pnpm wasm:build           # 构建 wasm（改 core-rust 后必须重建才能在 JS 侧生效）
pnpm i18n:extract         # Lingui 文案提取（改 UI 文案后）
```

## 3. 修改前 / 修改后的强制流程

1. **读文档**：按根目录 `AIRule.md` 的读取顺序与触发条件加载相关文档；领域词汇以根目录 `CONTEXT.md` 和 `docs/README.md` 为准。
2. **查符号**：新建/重命名任何符号前，先查 `docs/AI/PROJECT_SYMBOL_REGISTRY.md` 并 grep 代码库（详见该文件第 9 节流程）。
3. **改动后验证**：`pnpm typecheck` + `pnpm test`（相关范围）+ `pnpm ci:check`。验证未跑过就不许声称完成。
4. **登记新符号**：新函数/类型/常量确定保留后，追加登记到 `PROJECT_SYMBOL_REGISTRY.md` 对应小节。
5. **UI 改动**：遵守 `docs/AI/Design_System.md`（token、i18n、组件基元）。
6. **跨边界改动**（wasm 接口、adapter 接口、IPC 消息、文件格式）：遵守 `docs/AI/API_Design.md`，属破坏性变更，必须先获用户确认。

## 4. 行为红线（汇总，细则见各文档）

- 不重命名注册表锁定符号、不新建同功能重复符号（`PROJECT_SYMBOL_REGISTRY.md`）。
- 不跨层 import、不动单一代入者 seam（`System_Architecture.md`）。
- 不硬编码颜色/文案、不绕过 `@vault/theme`（`Design_System.md`）。
- 不改加密与存储格式契约，除非用户明确要求（`API_Design.md` + `docs/cryptography.md`）。
- 排查问题按 `AGENT.md` 的 Debug Investigation Protocol 自底向上，定位根因前不改代码。
