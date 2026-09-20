# Session log

## 2026-09-20 — 威胁模型汇总文档落地

- **里程碑**：新增 `docs/threat-model.md`，已登记进 `docs/README.md` 索引。
- **完成了什么**：
  - CodeGraph 现状审计（853 文件）：路线图 17 项中 15 项确认已存在于代码库，剩余差距仅威胁模型汇总与 CI 依赖审计。
  - 撰写 `docs/threat-model.md`：资产/敌手模型（A–G 七类）、六条信任边界、威胁→防御汇总表（整合 5 份 sec-audit + 2 份硬化设计）、6 条已接受残余、8 条改动红线、持续验证节。
- **关键决策**：文档定位为"汇总 + 指针"，不重复各 sec-audit 的 file:line 证据；已接受残余单列一节，防止未来被当新发现重报。
- **遗留事项**：#16 CI 加固（`cargo audit` / `pnpm audit` 进 CI）待用户确认后执行——涉及 `.github/workflows/ci.yml`，属需确认项。

## 2026-09-20 — CI 依赖审计 job 落地

- **里程碑**：`.github/workflows/ci.yml` 新增独立 `audit` job（Security (dependency audit)）。
- **完成了什么**：`pnpm audit --prod`（生产依赖）+ `cargo audit --locked` 分别审计 `packages/core-rust` 与 `platform-desktop/src-tauri` 两个独立 lockfile；cargo-audit 经 `taiki-e/install-action` 固定版本 0.21.2；YAML 已用 PyYAML 验证解析通过（7 jobs）。
- **关键决策**：独立 job 而非并入 build（advisory 失败一眼定位、不拖慢构建）；阻塞模式（用户判定由 AI 决定，选 fail-the-build——密码管理器的已知 CVE 不应静默通过）；策略写入注释：新 advisory 用带日期的定向 `ignore`，禁止一揽子禁用。
- **遗留事项**：本机无 pnpm，未能本地预跑 `pnpm audit`；首次 CI 运行时若有存量 advisory，需按注释策略逐条处置。

## 2026-09-20 — 审计日志第一阶段落地（PRD 缺口 B）

- **里程碑**：新增 `docs/audit-log.md`（设计）+ `packages/core/src/vault/audit-log.ts`（核心，4 测试通过）+ 三个挂载点。
- **完成了什么**：VEK 加密、vault-scoped（`audit.log:<vaultId>` meta 键）、fire-and-forget 的本地审计日志；挂点：unlock 成败/lock（useVault）、secret.copy（EntryRow，新增可选 entryId）、entry.export（exportVault/exportKdbx）。锁定态事件丢弃并计数，不缓冲明文。typecheck + Biome + vitest 全过。
- **关键决策**：加密复用 `CryptoAdapter.encryptWithVek`（单一映射，不开新 HKDF 面）；设计原想挂在 secret-text/secret-area 基元内，实测基元无 entryId 上下文，改挂持有 id 的屏幕层（EntryRow）；EntryRow 曾把 usePlatform() 写进异步回调违反 hooks 规则，已修正为组件顶部解构。
- **遗留事项**：autofill.fill / backup.run / device.enroll / device.revoke 挂点、设置页 Activity 面板（含 takeDroppedCount 的 UI 呈现）为后续增量；PRD 缺口 A（PC 副标题）经核实 tauri.conf.json 已含两行标题，无需改动。

## 2026-09-20 — CI 依赖审计闭环（#2 收官）

- **里程碑**：audit job 在 `f56f2a7d` 上首次全绿；全部 RustSec advisory 处置完毕并经 CI 验证。
- **完成了什么**：quick-xml 0.37→0.41（kdbx.rs 同步迁移到 `escape::unescape`，0.41 移除了 `BytesText::unescape` 且 `xml_content` 需要 XmlVersion 参数——两次编译错误教出来的）；rkyv/h2 走 CI 内 `cargo update -p` 补丁级升级；rustls 两处 lockfile 均 `--precise 0.23.45` 钉版（普通 update 只拉到 0.23.43，不达标）。JS 侧 `pnpm audit --prod` 本机验证零漏洞。残余 8 条 warning 级（unic-* unmaintained、proc-macro-error、glib unsound、chacha20 yanked）不阻塞，已知悉。
- **关键决策**：advisory 处置放 CI patch 步骤而非本地改 lockfile（本机无 cargo）；注释标明"committed lockfiles 追上后删除该步骤"。
- **流程教训**：改名（Bramble→Vautix）波及协议字符串属安全回归，pinned 测试向量抓住了它；rename 时必须 grep HKDF info / room label 这类"看似文案实为契约"的常量。
- **环境备忘**：本机轮询 GitHub API 直连可用（代理关闭时）；job 日志匿名 403，需用户从 Actions 页复制。
- **遗留事项**：Desktop (Linux .deb) job 仍红（kdbx.rs 编译错已修，但 Linux 打包链还有未诊断的问题）——下一个候选工作项；主 CI job 同理。

## 2026-09-21 — 会话结束快照（下次会话从此恢复）

- **本地领先远端 1 个提交**：`b7c53ced`（本文件的上一个里程碑），待用户下次推送时一并上去。
- **工作状态**：任务清单 5/5 完成；audit job 全绿（`f56f2a7d`）；core 单测 1310 全绿；工作区干净。
- **遗留事项（按优先级）**：
  1. Desktop (Linux .deb) job 仍红——kdbx.rs 编译错已修，Linux 打包链（疑似系统依赖或 keyring 相关）未诊断；主 CI job 同红，需一并看日志。
  2. 审计日志第二阶段：autofill.fill / backup.run / device.enroll / device.revoke 挂点 + 设置页 Activity 面板（设计见 docs/audit-log.md §6）。
  3. Roster phase-2 flip（安全价值最高）：先做五端 backfill 覆盖核查 + admissionKey pinning 确认，flip 决策须用户批准（威胁模型 §3 唯一"已知开口"）。
  4. VEK residency 硬化 #1（约 1 小时，停止返回未使用的 VEK，碰 FFI 契约面须谨慎）。
- **环境备忘**：推送由用户手动执行（项目记忆约定）；本机轮询 GitHub API 直连可用；job 日志匿名 403，需用户从 Actions 页复制；pre-commit 需 pnpm shim。

## 2026-09-20 — 项目接管与 fork 定位（当前状态快照）

- **项目定位确认（用户澄清，决定后续所有取舍）**：本仓库是从上游开源项目 **Bramble**（原作者 flythenimbus）下载后改名 Vautix 的 fork；未来供用户本人使用，可能少量给他人使用。→ 结论：**不需要兼容任何在役 Bramble 构建**，Vautix 内部的协议自洽即为充分条件。上条遗留事项 #16（CI audit）已完成，转为本节清单第 3 项。
- **完成/已确认**：
  1. core-rust 侧 `WEBAUTHN_KDF_INFO = "titanpass/webauthn/v1"` 保留旧名，属正确状态（持久化数据契约，见 `lib.rs:167` 的 "DO NOT fix" 注释），**禁止改名**。
  2. 改名提交 `24740e73` 触及的 7 处 TS 协议字符串（`nostr.ts` ×3、`pairing-sas.ts` ×1、`roster-sync.ts` roomLabel ×1、`enroll-host.ts` ×3）判定为**在线协议契约**（不落盘），新名 `vautix/...` 在 Vautix 内部自洽，**无需回退**。
  3. 三端/加密/同步/autofill/passkey/审计日志等 15/17 项功能此前已确认存在；当前无任何未提交的代码改动，工作树干净（HEAD = `2b3cb5de`）。
- **待完成任务清单**：
  1. **修 core 套件唯一失败测试**：`packages/core/src/sync/pairing-sas.test.ts`（pinned SAS 向量）是用旧字符串 `bramble/sync/sas/v1` 算出的，需按新 `SAS_INFO = "vautix/sync/sas/v1"` 重新生成预期值。改的是测试期望值，**不动协议代码**。
  2. **推送到自己仓库**：`git push origin main` 报 403（本机缓存账号 Jameyi 对 flythenimbus/bramble 无写权限，属预期）。需用户手动新建空仓库（不勾选 README/gitignore/license）→ `git remote set-url origin https://github.com/Jameyi/<新仓库>.git` → 推送。**所有 git 写操作由用户自己执行，AI 只提供步骤，不代跑。**
  3. **首跑 CI 后处置 audit job**：推送触发新仓库 CI，观察新增 `audit` job 是否有存量 advisory，按 job 注释的"带日期定向 ignore"策略逐条处置。
  4. 审计日志后续增量：autofill.fill / backup.run / device.enroll / device.revoke 四个挂点、设置页 Activity 面板。
- **阻塞 / 卡点**：
  - 任务 2 与 3 依赖用户手动推送完成，AI 无法代劳（用户明确要求）。
  - 本机未安装 pnpm，无法本地预跑 `pnpm test` / `pnpm audit`，测试与依赖审计结论只能靠 CI 或用户本机执行验证。
  - 任务 1 的测试修复需跑 vitest 确认，本机 pnpm 缺失同样影响验证，需用户执行或补齐 pnpm。
- **下一会话明确下一步**：
  1. 确认用户是否已完成推送（问一句即可）；已推送则先看 CI 的 `audit` job 首跑结果。
  2. 执行任务 1：重新生成 `pairing-sas` 测试的 pinned 向量，跑 core 套件确认 1310/1310 通过。
  3. 随后按用户意向决定是否继续任务 4 的挂点补齐。
