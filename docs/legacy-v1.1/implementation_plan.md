# FLUX V1 — Implementation Plan

**Operating model:** OpenCode is the lead engineer. Claude Code is a specialist collaborator. Herdr runs and coordinates the developer agents.  
**Delivery rule:** Prioritize a complete, installable end-to-end coding loop over a large collection of unfinished features.

## 1. Definition of done

V1 is done when a developer can install and launch `flux`, configure and switch between hosted and local-compatible provider profiles, assign models by agent role, open a repository, ask for a change, inspect the plan, approve edits, see a diff, run tests, inspect verification results, delegate a bounded subtask, and resume the session later.

A polished TUI without this complete workflow is not done.

## 2. Phase plan

### Phase 0 — Workspace audit and technical spike

**Tasks**
- Inspect the new project folder before creating or overwriting anything.
- Confirm OS, shell, Bun version, Git version, Herdr version, OpenCode and Claude Code availability.
- Verify OpenCode's effective BharatCode provider/model without exposing secrets; note quota availability without repeatedly retrying an exhausted endpoint.
- Verify Claude Code's effective local OmniRoute provider/model without exposing secrets.
- Identify at least one usable local OpenAI-compatible endpoint and one hosted endpoint; record capability facts without credentials.
- Create a provider capability matrix with `supported` / `unsupported` / `unknown` states for streaming, tool calls, usage reporting, cancellation, and output/context limits.
- Install/verify Herdr integrations for OpenCode and Claude Code.
- Build a tiny OpenTUI React app with a sidebar, panel, input, scroll area, mouse click and keyboard interaction.
- Verify startup, resize, Ctrl+C terminal cleanup, and packaging compatibility on Windows 11.
- Test the actual BharatCode endpoint's streaming and tool-call support only when quota is available and a single minimal non-secret capability request is appropriate; otherwise defer live testing and use mocks/local routes.

**Acceptance**
- A documented go/no-go for OpenTUI on the target machine.
- A verified multi-provider capability report (no credentials or inferred quota/pricing in report).
- No global configuration changed without explicit approval.

### Phase 1 — Repository and CLI foundation

**Tasks**
- Create the Bun workspace and TypeScript configuration.
- Create `apps/cli` and the initial package boundaries.
- Implement `flux --help`, `flux --version`, `flux doctor`.
- Implement config path resolution and redaction utilities.
- Define provider profile config schema, credential references, role model overrides, fallback-chain configuration, and budget settings.
- Add CLI command skeletons for `flux auth`, `flux providers`, `flux models`, and `flux usage`.
- Add lint, typecheck, test, and formatting scripts.
- Add README and contribution/engineering notes.

**Acceptance**
- Clean install and `bun run` workflows work on Windows.
- CLI commands have tests.

### Phase 2 — TUI shell and onboarding

**Tasks**
- Implement app shell and responsive layout.
- Add navigation/sidebar, conversation pane, inspector, composer, status bar.
- Implement keyboard navigation, focus states, mouse actions, scrollback and resize behavior.
- Add provider setup/profile manager, provider test flow, model picker, per-agent model routing, fallback configuration, and usage/budget screens.
- Add first-run welcome and setup validation.

**Acceptance**
- User can operate the shell using only keyboard and using mouse.
- TUI restores terminal state after exit/error.

### Phase 3 — Model provider and streaming

**Tasks**
- Define provider registry, provider interface, normalized event/usage/error types, and OpenAI-compatible adapter.
- Configure the verified BharatCode endpoint without hardcoding secrets or guessed URLs.
- Support generic custom endpoints and compatible local OpenAI-compatible gateways, including optional OmniRoute/LiteLLM, Ollama, and LM Studio routes.
- Implement default model selection and per-agent role overrides.
- Implement capability discovery/cache for streaming, tool calls, cancellation, and usage reporting.
- Implement user-configured fallback chains with strict partial-stream/no-duplicate-tool safeguards.
- Implement usage ledger, reported-vs-estimated labels, per-task/session/agent budgets, warnings, and hard-stop behavior.
- Add stream rendering, request cancellation, timeout, quota/rate-limit, auth, unsupported-capability, and budget-exhaustion handling.
- Keep credentials in OS credential storage or environment variables; never in project config or SQLite.

**Acceptance**
- User can configure and test at least two different provider profiles, switch providers/models without losing the session, set per-agent model overrides, stream/cancel responses, and see actionable errors.
- Simulated quota/rate-limit and transient failures exercise configured fallback safely; partial streams do not replay tool calls.
- Usage and budget tests prove correct reported/estimated labelling and budget enforcement.

### Phase 4 — Repository context and safe tools

**Tasks**
- Detect Git root and repository manifests.
- Implement ignore-aware file listing and repository map.
- Implement text search, read, write, patch, Git status/diff/log.
- Implement shell execution with explicit policy, timeout, cwd, argument handling, and output caps.
- Implement workspace path validation and secret-file exclusions.
- Add tool-call UI cards and approval dialogs.

**Acceptance**
- FLUX can accurately inspect a fixture repository.
- Unauthorized writes and out-of-workspace paths are blocked.
- User sees what command will run before approval.

### Phase 5 — Main agent loop and delegation

**Tasks**
- Implement bounded tool-call loop.
- Add task planning and approval before modifications.
- Add role profiles: main, explore, planner, implementer, reviewer, tester.
- Implement subtask delegation and structured result collection.
- Add step, time, concurrency and context budgets.
- Add agent lifecycle events and agent detail UI.

**Acceptance**
- Main agent can delegate a read-only investigation and use its structured result.
- Subagents cannot exceed tool permissions or approve their own changes.

### Phase 6 — Diff, testing, evidence and persistence

**Tasks**
- Implement unified diff display and changed-file list.
- Implement apply/reject/revise flow.
- Implement verification command execution and evidence record.
- Add SQLite schema/migrations and session repositories.
- Add session list, resume, delete, and retention behavior.
- Persist task states, tool summaries, approval decisions, patches, test results, provider profile metadata, per-role model choices, fallback configuration, usage ledger events, and budget state (never plaintext credentials).

**Acceptance**
- End-to-end task can modify a fixture repo, show diff, run tests and record exact results.
- Session resumes after application restart.

### Phase 7 — Packaging, hardening and release

**Tasks**
- Verify `bun link` and global command installation on Windows.
- Check package name/scope availability and choose the actual package name only after verification.
- Verify native optional dependencies and clean-machine installation.
- Add `flux doctor` checks for all required runtime components.
- Run security review, dependency/license review, secret scan and test suite.
- Write setup, usage, safety, troubleshooting and known-limitations documentation.
- Capture a short real end-to-end demo.

**Acceptance**
- A clean Windows environment can install and launch FLUX from the documented steps.
- No secrets or local machine-specific paths are committed.
- All V1 acceptance criteria in `spec.md` pass or are explicitly documented as a release blocker.

## 3. Suggested task ownership

OpenCode remains the single project lead and final integrator. Ownership below is a suggestion; OpenCode can reassign based on actual context and agent capability.

| Workstream | Suggested owner | Rules |
|---|---|---|
| Architecture, integration, core state model | OpenCode | Final design authority |
| OpenTUI Windows spike and UI review | Claude Code | Report findings first; implement only after assignment |
| Provider contract and endpoint capability test | OpenCode + Claude reviewer | Never disclose API keys; do not change global configs; avoid retrying exhausted quota |
| Provider registry/router/fallback/usage design | OpenCode | Owns interfaces and final integration |
| Provider adapter and mocked provider tests | Scoped Claude agent when assigned | One owner for provider files at a time; no credential leakage |
| Local endpoint compatibility and per-role routing review | Claude Code | Report verified capabilities and limitations |
| Repository tools and permission audit | Claude Code subagent | Work in assigned files/worktree; return tests and findings |
| Agent loop and delegation | OpenCode | Integrate and own runtime design |
| Tests, security review, docs | Claude Code subagents | Independent review; findings go to OpenCode |
| Final integration and release | OpenCode | Sole merge/release authority |

Do not spawn several agents to edit the same module concurrently. Use OpenCode native subagents for quick analysis and Herdr-launched Claude Code for substantial independent work or a second-model review. Because Claude's model is local, control concurrency according to actual hardware/model throughput.

## 4. Shared file collaboration protocol

All primary OpenCode/Claude Code file-based coordination goes through `agent_handoff.md`.

- OpenCode owns the task board, priorities, decisions, and integration status.
- OpenCode assigns a unique task ID, scope, acceptance checks, and owner before implementation.
- Claude Code reads the assignment, records a brief acknowledgement, works only in the assigned scope, then records changed files, commands/tests, findings, blockers, and handoff status.
- Claude must not rewrite or delete OpenCode's decision log.
- Multiple Claude child agents should report to OpenCode through Herdr; OpenCode writes the consolidated handoff to the shared file.
- Keep each handoff concise. Do not paste large logs or code dumps; record paths and summaries.
- Do not put secrets, API keys, personal data, or full environment dumps in this file.
- Source changes must have explicit ownership. Prefer a separate Git worktree/branch per concurrent implementation task. OpenCode alone integrates changes into the main working branch.

## 5. Work order and dependency graph

```text
Phase 0: audit + OpenTUI/provider spike
                  |
                  v
Phase 1: workspace + CLI foundation
                  |
                  v
Phase 2: TUI shell + onboarding
                  |
          +-------+-------+
          |               |
          v               v
Phase 3: multi-provider + usage    Phase 4: repo tools
          |               |
          +-------+-------+
                  |
                  v
          Phase 5: agent loop
                  |
                  v
       Phase 6: diff + verify + DB
                  |
                  v
        Phase 7: package + release
```

Parallelization is allowed only when interfaces are agreed and file ownership does not overlap. Phase 3 and Phase 4 can proceed in parallel after core types and permission contracts are agreed.

## 6. Mandatory quality gates

Before merging any implementation task:

1. Typecheck passes.
2. Relevant tests pass.
3. Lint/format checks pass for changed files.
4. No secrets are present in changed files or logs.
5. Permission and path-safety behavior is tested when tools are involved.
6. UI works at target terminal size and a narrow size when UI is involved.
7. Agent reports actual commands and results; never report tests that were not run.

Before V1 release:
- Run full automated suite.
- Run a clean Windows installation test.
- Run one real bug-fix demo and one feature-change demo.
- Demonstrate switching between hosted and local provider profiles, per-agent model selection, quota fallback (simulated if no live quota is safe to trigger), and usage/budget reporting.
- Verify session resume and user cancellation.
- Audit dependency licenses and record reused code.

## 7. Scope-control rules

- Build only what's required by `spec.md` for V1.
- Do not spend time on a web app, marketplace, remote server, vector database, or complex plugin API. Multi-provider support is required, but V1 is limited to a robust OpenAI-compatible adapter rather than every native vendor protocol.
- Do not add dependencies without a concrete need.
- When a feature is risky, deliver a smaller reliable version and record the limitation.
- Prefer working end-to-end vertical slices over broad scaffolding.
- If a choice is reversible, make a reasonable decision and document it; do not block waiting for the user.
- Ask the user only for credentials, destructive actions, or decisions that cannot safely be inferred.
