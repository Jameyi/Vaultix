# Design_System.md — 前端设计约束（Vaultix / Vautix）

- 版本: 1.0
- 日期: 2026-09-12
- 适用范围: `packages/core/src/app/**`（扩展/移动/桌面共享 UI）、`packages/theme/`、`website/src/**`
- 实现入口: `packages/theme/theme.css`（token 单一来源）、`packages/core/src/app/components/ui/`（基元库）

> **待补充说明**：用户计划引入 ui-ux-pro-max / frontend-design / design 等 skill 进一步充实视觉规范；
> 本文件先固化**结构性硬约束**（token、基元复用、暗色模式、i18n），视觉风格细则留待 skill 补充后追加，
> 追加时不得与第 1–4 节冲突。

---

## 1. 主题基线

- 唯一 token 来源是 `packages/theme/theme.css`（纯 CSS，**无构建步骤**），通过 Tailwind v4 `@theme inline` 映射为工具类（`bg-background`、`text-muted-foreground`…）。
- 引入顺序固定：`@import "tailwindcss";` 之后 `@import "@vault/theme/theme.css";`（README 有明文，顺序错了 token 映射失效）。
- 三个 surface（扩展、移动、网站）必须像素一致：改 token 只改 theme.css，改一处全端生效；禁止在某个 surface 的样式里覆盖 token 值。

## 2. Token 分层（用语义 token，禁用硬编码色）

**规则：组件内一律使用语义 token；禁止 `bg-emerald-*` / `text-slate-*` / `oklch(...)` / `#hex` 等硬编码颜色出现在业务组件代码中。**

可用 token（theme.css `:root` / `.dark` 定义）：

| 类别 | token |
|---|---|
| 背景/前景 | `background` `foreground` `card` `card-foreground` `popover` `popover-foreground` |
| 主色 | `primary` `primary-foreground` `secondary` `secondary-foreground` `accent` `accent-foreground` |
| 弱化 | `muted` `muted-foreground` |
| 危险 | `destructive` `destructive-foreground`（唯一错误/危险色，不另引入"红色系"） |
| 边框/输入 | `border` `input` `input-background` `ring` `switch-background` |
| 图表 | `chart-1` … `chart-5` |
| 侧栏 | `sidebar` 系列 |
| 其他 | `radius`（圆角基准，派生 `rounded-*`）、`font-size`、`font-weight-*` |

### 常用映射（硬编码 → 语义 token）

| 禁止写 | 应写 |
|---|---|
| `bg-white` / `bg-gray-50` | `bg-card` / `bg-background` |
| `text-black` / `text-gray-900` | `text-foreground` |
| `text-gray-500` | `text-muted-foreground` |
| `bg-gray-100` | `bg-muted` / `bg-secondary` |
| `border-gray-200` | `border-border` |
| `bg-red-600`（错误） | `bg-destructive` |
| 任意 hex / oklch 字面量 | 先找上表；确实没有的新语义 → 到 theme.css 定义 token，再引用 |

## 3. 暗色模式

- 机制是 `.dark` class + `@custom-variant dark`，**不是** `prefers-color-scheme` 媒体查询直接写样式。
- 防白闪：theme.css 的 `html:not(.theme-ready)` 预挂载规则只匹配 OS scheme；应用首次挂载后打 `.theme-ready`。新 surface 接入主题时必须复刻这一协议（见 theme.css 头部注释），不要自创第二套闪烁规避。
- 所有颜色都必须成对：新增 token 必须同时给出 `:root` 和 `.dark` 两个值，缺一禁止合入。
- 禁止在组件里写 `dark:` 变体来手工调色——那是 token 该做的事；`dark:` 仅用于布局/可见性差异等非颜色场景。

## 4. 字体与圆角动效

- 字号基于 `--font-size: 16px` 根值；字重用 `font-weight-medium` / `font-weight-normal` token。
- 圆角一律从 `--radius` 派生（`rounded-md` 等 Tailwind 半径档），不写任意 `rounded-[10px]`。
- 动效克制：过渡限于颜色/透明度/位移的微交互；密码管理器 UI 禁止抢眼动画（secret 显示/隐藏、toast 等已有基元自带行为，直接复用）。

## 5. 组件基元（components/ui/ 白名单）

- `packages/core/src/app/components/ui/` 是全部 UI 基元的家：button、text-field、password-field、modal、confirm-dialog、select-field、text-area、checkbox、dropdown-menu、range-field、toast、password-strength-meter、secret-text、secret-area、field-outline 等。
- **先复用，后扩展，最后才新建**：缺基元先看能否扩展现有文件；确需新建，命名用现有 kebab-case 风格，并登记到 `PROJECT_SYMBOL_REGISTRY.md` 第 6 节。
- 涉密展示（密码/密钥/恢复码）必须用 `secret-text` / `secret-area` 系基元，禁止直接明文渲染后自己加遮罩。
- 破坏性操作必须走 `confirm-dialog`，与 BulkAction"每个操作自带对话框、无立即执行路径"的约定一致。

## 6. i18n（硬约束）

- 所有用户可见文案用 Lingui macro（`<Trans>` / `t`）书写，禁止硬编码字符串进组件。
- 文案改动后跑 `pnpm i18n:extract`；新增语言/翻译流程见 `docs/i18n.md`。
- 图标用 `lucide-react`（core 内已有约定）；品牌图标放 `app/components/icons/`。

## 7. 样式工具栈

- 类名合并用 `clsx` + `tailwind-merge`（core）或 `tailwind-variants`（website），与既有代码保持一致，不引入第二套方案。
- 保存前跑 `pnpm ci:check`（Biome）确认格式与 lint 通过。
