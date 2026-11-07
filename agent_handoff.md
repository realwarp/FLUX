# FLUX — Shared Agent Handoff

> This is the single shared file-based communication channel for the primary OpenCode lead and primary Claude Code collaborator. Keep it concise. Never write credentials, tokens, personal data, or full environment dumps here.

## Operating agreement

- **Lead / final integration authority:** OpenCode (BharatCode model configuration).
- **Specialist collaborator:** Claude Code (existing local OmniRoute model configuration).
- **Agent runtime for the development team:** Herdr.
- **FLUX runtime:** Independent installable CLI/TUI; must not require Herdr.
- OpenCode owns priorities, task assignments, architecture decisions, integration, and release status.
- Claude acknowledges and completes scoped assignments; it does not run a competing implementation.
- Concurrent implementation must use isolated worktrees/branches or strictly disjoint file ownership.
- OpenCode collects child-agent reports from Herdr and records concise summaries here. Child agents should not concurrently edit this file.
- Preserve prior decisions and handoffs. Prefer adding dated entries rather than rewriting history.

## Project status

_Last updated: 2026-11-07 by OpenCode (lead)._

- **Current phase:** FLUX V1 MVP implemented and locally verified; documentation and release hardening complete. Manual interactive TUI validation remains.
- **Current release target:** FLUX V1 MVP.
- **Main branch:** Local repository initialized with `git init -b main`. Nothing is published; see `git log` for the baseline commit.
- **Last verified environment:** Windows 11 build 26300 x64; PowerShell 7.6.9; Bun 1.4.4; Node v24.19.0; npm 12.2.1; Git 2.55.0; Herdr 0.9.5; OpenCode 2.2.6; Claude Code 2.1.319; `rg` present. No secrets recorded.
- **OpenTUI Windows spike:** PASS for build/typecheck and a real headless E2E. `@opentui/core` / `@opentui/react` 0.8.3 install and resolve on Windows x64 (native package under `node_modules/.bun/...`, handled by `flux doctor`). Manual mouse/keyboard/resize/exit validation in a live terminal is still pending.
- **Local provider route:** Verified against Ollama at `http://127.0.0.1:11434/v1`. Available models: `qwen35-9b-32k:latest`, `qwen35-9b-20k:latest`, `qwen3.5:9b-q4_K_M`. OpenAI-compatible streaming chat works and reports usage. `flux providers test` records only demonstrated capabilities (`streaming/toolCalls` may stay `unknown`).
- **BharatCode streaming/tool-call capability:** BLOCKED — daily student quota exhausted during planning. Do not retry repeatedly; use local/mocked routes until reset.
- **Claude Code local model route:** Existing OmniRoute configuration is expected to supply it; not re-verified because Herdr automation is blocked. Do not change global OmniRoute/Claude/OpenCode config.
- **Herdr orchestration:** BLOCKED — `herdr status server` returns `PermissionDenied` and requests an elevated terminal (`--allow-unelevated-clients`). OpenCode used its own subagent tooling for local work. Herdr remains development-team tooling only, never a FLUX dependency.
- **Verification evidence:** `bun x tsc --noEmit -p tsconfig.json` passes; `bun test` = 34 pass / 0 fail; real `flux run` E2E returned `FLUX READY`, ran a tool command, and persisted a verification row (`exit 0`, `passed`).

## Task board — OpenCode owns this section

| ID | Task | Owner | Scope | Status | Acceptance |
|---|---|---|---|---|---|
| FLUX-001 | Audit workspace and verify development environment | OpenCode | Read-only | **completed 2026-11-07** | Environment facts recorded without secrets (see Project status) |
| FLUX-002 | OpenTUI/Bun Windows interaction spike | OpenCode; Claude review | Spike folder/files assigned by lead | **partial** | Builds, typechecks and runs on Windows x64; native package resolves; manual mouse/keyboard/resize/scroll/clean-exit check still pending |
| FLUX-003 | Verify BharatCode provider capabilities | OpenCode | Provider config inspection/test only | **blocked** | Daily quota exhausted; do not retry until reset. Local Ollama streaming/usage verified; capabilities recorded only when demonstrated |
| FLUX-004 | Approve V1 technical baseline | OpenCode | Docs and architecture | **completed 2026-11-07** | Baseline decisions D-008..D-014 recorded below |
| FLUX-005 | Multi-provider architecture and quota-aware routing | OpenCode; Claude review | Provider contract, profile schema, model routing, fallback, usage/budgets | **completed 2026-11-07** | Hosted + local profiles, per-role overrides, opt-in fallback and usage/budget tests implemented (34 tests pass) |
| FLUX-006 | Implement V1 vertical slices (CLI, TUI, tools, persistence) | OpenCode | `apps/`, `packages/` | **completed 2026-11-07** | Typecheck passes; CLI commands and TUI launcher wired |
| FLUX-007 | Automated test coverage | OpenCode | `tests/` | **completed 2026-11-07** | Provider/fallback, budget, security/path, patch and persistence suites: 34 pass / 0 fail |
| FLUX-008 | Local end-to-end verification | OpenCode | Isolated `FLUX_HOME` | **completed 2026-11-07** | Doctor PASS; provider add/test PASS; `flux run` returned `FLUX READY`; command tool ran and verification persisted; sessions/usage correct |
| FLUX-009 | User and operator documentation | OpenCode | `README.md`, `docs/`, `THIRD_PARTY_NOTICES.md` | **completed 2026-11-07** | Setup, safety, troubleshooting and third-party notices written and linked |
| FLUX-010 | Manual TUI and install-path validation | OpenCode | Real terminal + `bun link` | **partial** | `bun link` succeeded and `flux --version` returned `0.1.0`; manual mouse/keyboard/resize/scroll/clean-exit check still pending |
| FLUX-011 | Claude Code independent review of V1 | Claude Code | Read-only review; `agent_handoff.md` response | **queued** | Findings recorded below; no concurrent edits to source |
| FLUX-012 | BharatCode live capability test | OpenCode | One minimal probe when quota resets | **blocked** | Streaming/tool-call/usage results recorded without exposing credentials |

## Decisions — OpenCode owns this section

| ID | Decision | Rationale | Date |
|---|---|---|---|
| D-001 | Herdr is the development-team agent cockpit, not a FLUX runtime dependency. | Separate developer orchestration from the end-user product. | Initial brief |
| D-002 | OpenCode is the lead; Claude Code is a specialist collaborator. | One integration authority avoids competing implementations. | Initial brief |
| D-003 | Use one shared file-based handoff channel: this file. | Durable coordination and clear ownership. | Initial brief |
| D-004 | FLUX V1 is an installable CLI with its own mouse-first hybrid TUI. | The delivered product must be usable without Herdr. | Initial brief |
| D-005 | OpenTUI is the preferred TUI candidate pending Windows validation. | TypeScript/native terminal renderer with mouse and keyboard support. | Initial brief |
| D-006 | FLUX V1 must support multiple OpenAI-compatible provider profiles, including compatible local gateways. | Avoid vendor lock-in and dependence on one daily quota; provider switching must not lose session state. | 2026-11-07 |
| D-007 | Per-agent model overrides, opt-in safe fallback, usage visibility, and task/session budgets are V1 requirements. | Allow cost/latency/quality trade-offs while preventing silent paid-provider switching and duplicate tool execution. | 2026-11-07 |
| D-008 | Implement FLUX as a Bun workspace monorepo with strict TypeScript, `zod` schemas, and `bun:sqlite`. | Keeps modules small, typed and testable; avoids native build tooling on Windows. | 2026-11-07 |
| D-009 | Use OpenTUI (`@opentui/core` + `@opentui/react` 0.8.3) for the TUI, pending manual interaction validation. | It installs and runs on Windows x64 with Bun 1.4.4 and supports mouse and keyboard input. | 2026-11-07 |
| D-010 | Credentials are environment-only via `env:VARIABLE_NAME`; raw keys are rejected; no OS credential-store adapter in V1. | Avoid secret persistence and keep policy auditable. | 2026-11-07 |
| D-011 | Fallback is opt-in and only eligible for retryable `quota-exhausted`, `rate-limit`, `network` or `transient` failures before any partial output; tool calls are persisted before dispatch and de-duplicated. | Prevent silent provider switching and duplicate side effects. | 2026-11-07 |
| D-012 | Every `run_command` result is persisted as verification evidence and surfaced as a `verification` event. | Ground "tests passed" claims in recorded command, exit code and duration. | 2026-11-07 |
| D-013 | Do not publish or assume a package name; install locally with `bun link` until ownership/licensing is verified. | Avoid squatting or accidental release under an unverified name. | 2026-11-07 |
| D-014 | Herdr remains development-team tooling only; use OpenCode native subagents when Herdr is unavailable. | FLUX must never depend on Herdr; this environment's Herdr server is permission-blocked. | 2026-11-07 |

## OpenCode → Claude Code assignments

OpenCode adds assignments here. Each assignment must have a unique ID, expected outcome, file scope, constraints, and acceptance criteria.

### CLAUDE-001 — Independent V1 review (queued)

- **Status:** queued. Herdr automation is blocked in this environment; this can be run manually in a Claude Code session using the existing OmniRoute route, without changing global config.
- **Owner:** Claude Code (specialist reviewer).
- **Scope:** read-only review of `README.md`, `docs/`, `spec.md`, `architecture.md`, `packages/`, `apps/`, `tests/`, and `agent_handoff.md`. Do not edit source files.
- **Expected outcome:** concise findings ordered by severity: correctness, safety/permission gaps, provider/fallback edge cases, Windows issues, doc mismatches, and missing tests.
- **Constraints:** do not run destructive commands; do not access credential files; do not paste secrets or environment dumps; do not edit `agent_handoff.md` outside the Claude response section; no concurrent source edits.
- **Acceptance:** findings include file references and concrete repro/verification steps; response recorded under “Claude Code → OpenCode responses”.

### CLAUDE-002 — BharatCode capability follow-up (blocked)

- **Status:** blocked on daily quota reset. Do not retry the endpoint repeatedly.
- **Owner:** OpenCode (lead) or Claude Code if quota is available in its route.
- **Scope:** one minimal streaming request with a tool definition; record streaming/tool-call/usage only if demonstrated.
- **Constraints:** never print or store the credential; never infer capabilities from the model name.
- **Acceptance:** `agent_handoff.md` updated with observed capabilities and a timestamp, or “still blocked”.

## Claude Code → OpenCode responses and handoffs

Claude adds concise acknowledgement/findings/completion entries below. Do not edit OpenCode's sections above.

### Initial independent review

- **Status:** pending (CLAUDE-001 queued; Herdr unavailable).
- **Task:** Review the implemented FLUX V1 code, tests, safety policy and documentation. Verify that claims in `README.md`/`docs/` match the code and that V1 acceptance criteria in `spec.md` are covered.
- **Findings:** To be added by Claude Code after inspecting the actual environment and files. Focus on correctness, safety gaps, fallback/tool-call edge cases and Windows behavior.
- **Blockers:** Herdr server access is denied; use a manually launched Claude Code session or defer.

## Child-agent reports — OpenCode maintains this section

For Claude Code child agents or OpenCode native subagents, OpenCode records one concise report per task after collecting the result. Include task ID, agent, changed files (if any), test results, and integration status.

_No delegated child-agent reports. The entries below are lead implementation records, not child-agent claims._

### 2026-11-07 — OpenCode lead implementation record

- **Task IDs:** FLUX-004..FLUX-009.
- **Agent:** OpenCode lead (no Herdr child agents; Herdr permission-blocked).
- **Delivered:** Bun workspace (shared, providers, permissions, repository, tools, persistence, agent-runtime, app-core, TUI, CLI); provider registry/router/fallback/usage/budgets; permission policy and approvals; workspace-safe tools and patch engine; SQLite schema; agent loop with verification evidence; CLI commands (`doctor`, `auth`, `providers`, `models`, `usage`, `sessions`, `run`, `resume`); OpenTUI hybrid TUI with mouse approvals and `Ctrl+F` fallback; docs and notices.
- **Changed files:** all files under `apps/`, `packages/`, `tests/`, plus `README.md`, `docs/`, `THIRD_PARTY_NOTICES.md`, `agent_handoff.md`. The pre-existing brief files were not rewritten.
- **Verification:** `bun x tsc --noEmit -p tsconfig.json` passes; `bun test` = 34 pass / 0 fail; local Ollama E2E with isolated `FLUX_HOME` returned `FLUX READY`, ran a command tool, and persisted verification (`exit 0`, `passed`).
- **Integration status:** complete for automated/local checks. Manual TUI interaction and global-link install checks remain (FLUX-010).

## Risks and blockers

- **Herdr blocked:** `herdr status server` → `PermissionDenied` ("elevated server… use an administrator terminal… --allow-unelevated-clients"). Do not attempt privilege escalation; run Claude Code manually if needed.
- **BharatCode quota exhausted:** do not retry repeatedly; use local Ollama or mocks. Re-test once quota is available and record only demonstrated capabilities.
- **Manual TUI validation outstanding:** mouse, keyboard, resize, scroll and clean exit have not been exercised in a live terminal. The build/typecheck and TUI launcher are verified; treat usability claims as unverified until FLUX-010.
- **OpenTUI native licensing:** the Windows native package declares `MIT AND LGPL-2.1-or-later` and bundles FFmpeg/Ghostty/libwebp/LCMS2/STB/Wuffs/zlib notices. `THIRD_PARTY_NOTICES.md` records this; preserve all license files before distributing.
- **No OS credential store:** credentials remain environment variables and are visible to processes running as the same user.
- **Windows shell semantics:** commands run through Windows PowerShell, not Bash; quoting, `$` interpolation and path syntax differ. Stdin is disconnected.
- **Denylist is best-effort:** shell indirection, scripts and encoded commands can evade regex checks. Approvals and human review remain the primary control.
- **Package identity unverified:** do not publish or assume a package name/scope/license compatibility until ownership and native licensing are reviewed.
- **Provider variability:** OpenAI-compatible endpoints differ in `/models`, streaming, tool calls, usage and error bodies. Capabilities stay `unknown` until demonstrated; never infer them.
- **SQLite concurrency:** multiple FLUX processes against one database can lock it; run one TUI per user home.
- **Avoid concurrent edits** to the same source files and this handoff file. Claude's review is read-only.

## Activity log

- Initial collaboration contract created. Waiting for OpenCode and Claude Code to inspect the workspace and verify the actual environment.
- 2026-11-07: V1 scope expanded to first-class multi-provider profiles, per-agent model routing, opt-in quota/transient fallback, usage tracking, and configurable budgets. BharatCode daily allowance was exhausted during planning; avoid repeated retries and use local/mocked work until reset.
- 2026-11-07: Phase 0 audit completed. Windows 11 build 26300 x64, PowerShell 7.6.9, Bun 1.4.4, Node 24.19.0, npm 12.2.1, Git 2.55.0, Herdr 0.9.5, OpenCode 2.2.6, Claude Code 2.1.319, `rg` present. Local Ollama verified with OpenAI-compatible streaming and usage.
- 2026-11-07: FLUX V1 implemented as a Bun workspace monorepo. CLI, TUI, multi-provider routing, per-role models, opt-in fallback, usage/budgets, safe tools, SQLite persistence, verification evidence, and bounded subagents are wired.
- 2026-11-07: Automated verification: `bun x tsc --noEmit -p tsconfig.json` passes; `bun test` = 34 pass / 0 fail. Local E2E in isolated `FLUX_HOME`: doctor PASS, provider add/test PASS, `flux run` returned `FLUX READY`, command tool executed, verification row persisted (`exit 0`, passed), sessions/usage listed correctly.
- 2026-11-07: Documentation completed: `README.md`, `docs/setup.md`, `docs/safety.md`, `docs/troubleshooting.md`, `THIRD_PARTY_NOTICES.md`. Handoff updated; local `main` repository prepared for baseline commit.
- 2026-11-07: Blockers recorded: Herdr server PermissionDenied (elevated terminal required), BharatCode daily quota exhausted, manual TUI interaction and `bun link` install checks still pending. No secrets were read, printed or stored.
