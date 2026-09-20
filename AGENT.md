# AGENT.md — AI 行为准则（Vaultix / Vautix）

Behavioral guidelines to reduce common LLM coding mistakes. Project-specific
constraints live in `docs/AI/` — this file holds the universal rules and points
there; it does not duplicate them.

Tradeoff: These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## Document Priority

**The reading order and document map live in `AIRule.md` — read it FIRST and
follow its mandatory sequence. Do not rely on the list below; it is only a summary.**

In short (see `AIRule.md` for the authoritative version):

1. `AIRule.md` — rule-loading entry: read order, triggers, closing duties
2. `AGENT.md` (this file) — behavioral guidelines and hard rules
3. `docs/AI/CONTEXT.md` — environment facts, commands, mandatory workflow
4. Root `CONTEXT.md` — domain vocabulary (authoritative definitions)
5. `docs/AI/PROJECT_SYMBOL_REGISTRY.md` — before naming/renaming anything
6. Conditional (required when triggered): `System_Architecture.md`, `API_Design.md`, `Design_System.md`, `docs/README.md` index, `SESSION.md`

Do NOT try to read everything. Focus only on documents relevant to the task.
At a milestone, follow the `SESSION.md` protocol defined in `AIRule.md`.

## 1. Think Before Coding

Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

Touch only what you must. Clean up only your own mess.

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

Define success criteria. Loop until verified.

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## Execution Constraints (Hard Rules)

These rules override all other guidelines. They are mandatory.

### Scope Control

- Before making changes, list the files you will modify.
- You may modify at most 3 files per iteration.
- Do not change unrelated files, even if improvements are obvious.

### Verification Required

Work is NOT complete unless ALL of the following pass (run what the change touches):

- `pnpm typecheck` (TS changes)
- `pnpm test` (logic changes; `pnpm wasm:test` if core-rust changed)
- `pnpm ci:check` (Biome, after any formatting-relevant edit)

If no tests exist for the area:
- You MUST define clear acceptance criteria before coding.

### Failure Handling (Critical)

If a task fails twice:

1. STOP making further code changes
2. Summarize: what was attempted, why it failed
3. Propose a simpler alternative
4. Wait for user confirmation

Do NOT continue blindly.

### No Fake Completion

You are forbidden from saying "Done" / "Fixed" / "Completed" unless:
- acceptance criteria are explicitly satisfied
- verification steps have passed

### Minimal Iteration Loop

Each iteration must follow:
1. Clarify goal
2. Define verification
3. Make minimal change
4. Verify

Do not batch large changes.

---

## Debug Investigation Protocol

When fixing any bug, the agent MUST follow a bottom-up debugging strategy and
must NOT modify implementation until the investigation phase is completed.

Always investigate from simplest, lowest-risk causes to complex ones:

- **Level 0 — Environment**: correct project/package? correct branch? latest code loaded? right command and URL?
- **Level 1 — Loading**: is the file imported, the component rendered, the module wired in?
- **Level 2 — Configuration**: build config, tsconfig, vite config, manifest, env vars.
- **Level 3 — Data flow**: props, state, adapter responses, sync/merge results, transformations.
- **Level 4 — Implementation**: React components, business logic, algorithms — only after the above are verified.
- **Level 5 — Refactoring**: forbidden during bug fixing. Only after the bug is fixed, tests pass, and the user approves.

Before making changes, provide:
1. Symptom description
2. Possible causes ranked by probability
3. Checks performed
4. Root cause
5. Minimal fix

Do not modify code before identifying root cause.

---

## Naming Conventions

1. Domain terms MUST come from root `CONTEXT.md` and the `docs/README.md`
   vocabulary section (VEK / KEK / DEK / Slot / primary unlock method, VaultEntries,
   EntryMutations, …). MUST NOT create synonymous new terms (e.g. `masterKey` for VEK).
2. MUST follow each module's existing case conventions (camelCase functions,
   PascalCase types/components, kebab-case UI primitive files, `XxxRoute` /
   `XxxScreen` patterns — see `docs/AI/PROJECT_SYMBOL_REGISTRY.md`).
3. Before creating or renaming any symbol: consult
   `docs/AI/PROJECT_SYMBOL_REGISTRY.md` and search the codebase. Reuse; never duplicate.
4. If you must rename an existing element:
   1. Update all references (imports, usages, tests).
   2. Update contracts if applicable (`docs/AI/API_Design.md` scope — user confirmation required).
   3. Update `docs/AI/PROJECT_SYMBOL_REGISTRY.md`.

## Environment Notes (replaces any older instructions you may have seen)

- Package manager is **pnpm** (monorepo, `pnpm-workspace.yaml`). There is **no**
  `npm run dev:reset` / `dev:health` / `dev:start`, no FastAPI backend, no
  PostgreSQL/Redis, and no port table in this project. Commands that exist are
  in the root `package.json` scripts — never invent one.
- `docs/AI/CONTEXT.md` §2 lists the commands that actually exist.
