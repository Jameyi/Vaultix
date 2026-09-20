# AIRule.md — AI 规则加载入口（Vaultix / Vautix）

> **本文件是 AI 进入本项目的第一份必读文档**：规定按什么顺序读哪些约束文档、哪些必读哪些按需读、以及收尾义务。
> 各文档内容本身不在这里重复——这里只做"路由 + 顺序 + 触发条件"。
> 文档体系有变动（增删文档、改职责）时必须同步更新本文件。

---

## 1. 文档地图

| # | 文档 | 职责 |
|---|---|---|
| 0 | `AIRule.md`（本文件） | 规则加载入口：读取顺序、触发条件、收尾义务 |
| 1 | `AGENT.md` | 通用 AI 行为准则（四大准则、硬规则、调试协议、命名约定） |
| 2 | `docs/AI/CONTEXT.md` | 环境事实、真实存在的命令、改动前后强制流程、行为红线汇总 |
| 3 | `CONTEXT.md`（根目录） | 领域词汇表（权威定义：VaultEntries、EntryMutations、VEK/KEK/DEK、vault scoping 不变式等） |
| 4 | `docs/AI/PROJECT_SYMBOL_REGISTRY.md` | 唯一权威符号清单：锁死符号、防重复实现、新符号登记义务 |
| 5 | `docs/AI/System_Architecture.md` | 既有分层描述、代码归位表、依赖方向、单一写入者原则 |
| 6 | `docs/AI/API_Design.md` | 跨边界契约清单（wasm/FFI/磁盘格式/IPC/adapter）与变更流程 |
| 7 | `docs/AI/Design_System.md` | 前端设计硬约束（token、基元白名单、暗色模式、i18n） |
| 8 | `SESSION.md` | 里程碑记录（AI 写、AI 读，见第 4 节协议） |
| 9 | `docs/README.md` | 设计文档索引：各主题的深层"为什么"，按需查阅 |

## 2. 读取顺序（每次任务开始时）

### 必读（任何任务都要按此顺序读完）

1. **AIRule.md**（本文件）——知道规则体系长什么样
2. **AGENT.md**——行为准则与硬规则生效
3. **docs/AI/CONTEXT.md**——环境事实与命令生效（尤其是：本项目没有后端/数据库/`dev:reset`，禁止执行不存在的命令）
4. **CONTEXT.md**（根目录）——领域词汇装载，术语必须与之一致
5. **docs/AI/PROJECT_SYMBOL_REGISTRY.md**——符号锁生效：动任何名字之前先查这里

### 按需读（满足触发条件才读，但一旦触发为必读）

| 触发条件 | 必读 |
|---|---|
| 要新写 / 移动 / 组织代码（几乎所有编码任务） | `docs/AI/System_Architecture.md` |
| 改动触及 wasm 导出、FFI、磁盘/文件格式、IPC 消息、adapter 接口、package.json scripts、env 变量 | `docs/AI/API_Design.md` |
| 改任何 UI（组件、样式、文案、颜色） | `docs/AI/Design_System.md` |
| 任务涉及某个主题的深层设计（加密、同步、autofill、导入…） | `docs/README.md` 索引 → 对应主题文档 |
| 跨会话恢复上下文 / 接续上次工作 | `SESSION.md` |

### 读取纪律

- 顺序不可跳过：后面的文档依赖前面的（如不懂词汇表就无从判断符号注册表）。
- 按需文档被触发时与必读同级，不得跳过。
- 文档之间冲突时，优先级：根目录 `CONTEXT.md`（领域定义）> `PROJECT_SYMBOL_REGISTRY.md`（符号）> `docs/AI/` 其余 > `AGENT.md`（通用准则）。冲突本身要报告给用户修正文档。

## 3. 收尾义务（任务结束时核对）

1. 新增/重命名的符号已登记进 `PROJECT_SYMBOL_REGISTRY.md` 对应小节。
2. 触及的契约文档（`vault-format.md`、`docs/AI/API_Design.md` 等）已同步，文档与实现不出现两个说法。
3. 验证已跑（`pnpm typecheck` / `pnpm test` / `pnpm ci:check`，按 AGENT.md 硬规则）。
4. 达到里程碑时执行第 4 节 SESSION.md 协议。

## 4. SESSION.md 里程碑协议

`SESSION.md` 是 AI 的工作记忆，由 AI 写、AI 读，用户不维护。规则：

- **何时写**：每当一段工作到达里程碑（一个功能完成并验证通过、一次大重构收尾、一次重要决策敲定、或用户说"记录一下"）——追加一节，不覆盖历史。
- **写什么**（每条里程碑一节，倒序或按时间均可，保持一致）：
  - 日期
  - 里程碑标题（一句话）
  - 完成了什么（1–3 行）
  - 关键决策与理由（尤其是违反过/确认过默认规则的）
  - 遗留事项 / 下一步（如有）
- **何时读**：新会话开始、接续上次工作时先读它恢复上下文；按需文档触发表里已列。
- **边界**：只记里程碑级信息，不复制代码、不替代 git 提交信息；过时内容不删（历史即上下文），但可在新条目里注明"上条遗留事项已完成"。
- 文件为空或不存在时，从当前里程碑开始写即可。
