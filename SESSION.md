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
