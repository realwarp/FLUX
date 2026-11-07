# FLUX V1 — Product Specification

**Status:** Build brief for V1 MVP  
**Product:** FLUX  
**Category:** Terminal-native AI coding agent  
**Primary interface:** Mouse-first hybrid TUI  
**Primary developer environment:** Windows 11 + PowerShell, with cross-platform support as a goal

## 1. Product vision

FLUX is an installable, terminal-native AI software engineering agent. A developer installs it from a package manager, launches `flux` inside a repository, connects a model provider, and can immediately ask it to understand, plan, modify, test, and review a codebase.

The product should feel familiar to users of OpenCode and Claude Code, while offering a strong visual TUI inspired by the interaction patterns of Herdr: visible workspaces, agent activity, status, and easy switching between work. FLUX is an independent application. Herdr is used by the development team to coordinate the agents building FLUX; Herdr is not a required runtime dependency of FLUX.

**Product promise:** FLUX can take a real engineering task from request to inspected code changes and executed verification, while keeping the developer informed and in control.

## 2. V1 objective

Ship a genuinely usable, installable V1 MVP—not a mockup. A new user should be able to:

1. Install FLUX from a terminal (initially from the local repository; package-manager release once publishing details are ready).
2. Run `flux` in a project directory.
3. Connect and save one or more model providers (cloud or local) through a guided setup flow.
4. Select a default model, optionally override models per agent role, and start an interactive coding session.
5. Ask FLUX to inspect a repository, explain code, plan a change, implement it, run tests, and review the diff.
6. Delegate bounded work to specialist subagents and see their status and outputs.
7. Approve or reject file writes and commands that need confirmation.
8. Resume a saved session.

## 3. Target user and use cases

### Primary user

A developer who works in a terminal, uses AI coding assistants, and wants a persistent, observable, controllable coding workflow without needing a browser dashboard.

### Core use cases

- Understand an unfamiliar repository.
- Find the source of a bug and propose a repair.
- Implement a feature across multiple files.
- Refactor code while preserving existing behavior.
- Run the project's tests, lint, type-check, and build commands.
- Review a diff and explain the consequences of a change.
- Ask an independent agent to review a plan, implementation, or failure.

## 4. V1 functional requirements

### 4.1 CLI and onboarding

Required commands:

- `flux` — launch the interactive TUI in the current directory.
- `flux --version` — print the installed version.
- `flux doctor` — check runtime, config, provider connectivity (without exposing secrets), Git, and required dependencies.
- `flux auth` — guided provider connection/configuration flow.
- `flux models` — list configured providers/models or open model selection.
- `flux providers` — list, add, test, disable, or remove provider profiles.
- `flux usage` — show recorded token/request usage and configured budget status.
- `flux --help` — show concise command help.

The first-run onboarding must explain provider setup and offer an interactive connection path. The application must not require users to edit source code to connect a provider.

The global package name and publishing scope are undecided. Do not publish under an assumed name. First make local development and local linking/install work; verify package-name availability and ownership before publishing.

### 4.2 Multi-provider and model layer

Multi-provider support is a first-class V1 requirement. FLUX must not depend on one vendor, one endpoint, or one daily allowance. A user must be able to switch providers/models without changing source code or restarting a project session.

**V1 protocol scope**

- Implement a provider registry and a provider-independent model interface.
- V1 must support OpenAI-compatible chat-completions endpoints with configurable `baseURL`, API key/credential reference, model ID, and optional request metadata.
- Provide guided setup for the verified BharatCode-compatible endpoint and generic custom OpenAI-compatible endpoints.
- Support compatible local gateways and runtimes such as OmniRoute/LiteLLM, Ollama, and LM Studio when their configured endpoint implements the capabilities FLUX needs. These are endpoint configurations, not claims of universal native API compatibility.
- Keep the adapter boundary open for native provider protocols later, but do not expand V1 into an adapter for every vendor API.
- Never assume or hardcode endpoint URLs, model IDs, auth headers, context windows, pricing, or provider quota limits. Verify from the user's supplied configuration or current provider documentation.

**Provider profiles and model routing**

- Users can save multiple named provider profiles and mark one as the default.
- Each profile can contain one or more model IDs plus discovered/verified capabilities.
- The main agent and specialist roles (`explore`, `planner`, `implementer`, `reviewer`, `tester`) can inherit the default model or override it with a specific provider/model.
- The TUI must show the active provider/model for the current response and for each agent.
- Users can switch the active provider/model for a session without losing conversation or task state.
- `flux auth` manages credentials/setup; `flux providers` lists and tests configured profiles; `flux models` lists/selects available configured models; `flux usage` displays recorded usage.
- Store non-secret provider metadata in user-level config. Store credentials in an OS-appropriate credential store where feasible, or read them from environment variables. Never write plaintext API keys to project config, SQLite, transcripts, logs, screenshots, or `agent_handoff.md`.
- A user must be able to edit, test, disable, and remove a provider profile without changing global OpenCode, Claude Code, or OmniRoute configuration.

**Provider capability checks**

For each provider/model, record only verified capabilities such as streaming, tool calls, structured output, cancellation, reported token usage, context limit, and maximum output tokens. Capability values may be `supported`, `unsupported`, or `unknown`; do not infer support from a model name. If required tool-calling behavior is unavailable, FLUX must clearly warn and disable unsafe agent-tool execution for that route rather than interpreting arbitrary model text as a command.

**Fallback and quota handling**

- Users may configure an ordered fallback chain globally or per agent role, including a local model route.
- Automatic fallback must be opt-in and visible. It may occur on clearly classified quota/rate-limit responses or transient service/network failures before any partial assistant/tool output has been accepted.
- Do not automatically retry/fallback on invalid credentials, permission errors, malformed requests, or unsupported capabilities; show an actionable error.
- If a stream has already emitted partial output or tool-call fragments, do not silently replay the request through another provider. Stop, preserve the partial transcript as interrupted, and ask the user or apply a documented safe recovery policy.
- Never execute a tool call twice because a provider retry occurred. Tool execution is controlled by FLUX and must be idempotency-aware.
- The TUI must explain which provider failed, why fallback was selected, and which model is now active. Users can disable fallback per session.

**Usage and budgets**

- Track per-request and aggregate usage by provider, model, session, task, and agent: input tokens, output tokens, total tokens, request count, and timestamp when available.
- Distinguish provider-reported usage from estimated usage. Never label estimates as exact token counts.
- Show provider-reported quota/reset information only when the provider exposes it; never infer a provider's external allowance or reset time.
- Support configurable request/token budgets at least per task and per session, with optional per-agent limits. Enforce exact token ceilings when the provider reports usage and supports a usable output-token limit; otherwise use conservative request and max-output controls and clearly label token totals as estimates.
- Warn before a configured budget is exhausted and stop or request approval when a hard budget is reached. Do not silently switch to a paid provider.
- Show cost only when verified pricing metadata is available or user-supplied; label it estimated and show the pricing source/date. Local-model cost must not be presented as universally zero.
- Provide a compact usage view in the TUI and a `flux usage` command.

**Configuration and security**

- Provider settings are user-scoped by default. Project-level config may select a provider profile/model by ID but must never contain credentials.
- Environment-variable overrides are supported for headless/CI use.
- Redact secrets from errors, telemetry (none by default), handoffs, debug logs, and diagnostic output.
- Do not copy the developer's OpenCode/Claude/OmniRoute credentials into FLUX automatically. The user must explicitly configure a FLUX provider profile or use a deliberate secure import flow if one is implemented later.

### 4.3 Interactive TUI

The interface is mouse-first but fully usable by keyboard.

Required layout areas:

- Header: project, provider/model, session status, connection state.
- Navigation/sidebar: sessions, tasks, agents, files/context, settings.
- Main conversation/work area: streamed assistant output, tool activity, task plan, results.
- Inspector: current agent, task status, changed files, approvals, or verification detail.
- Composer: multiline prompt input, file/context attachments, command hints.
- Status/footer: keyboard shortcuts, active model, running tools, and token/usage data when available.

Required interactions:

- Mouse click for navigation, tabs, actions, agent/session selection, approval controls, and expandable tool output.
- Keyboard shortcuts for core navigation, submit, cancel, command palette, and panel switching.
- Scrollback, selectable text, resize handling, focus indicators, and a usable narrow-terminal layout.
- Do not require a mouse. Do not make keyboard operation a second-class path.
- Show agent states such as idle, working, waiting for approval, blocked, failed, and completed.

### 4.4 Repository awareness

- Detect the current working directory and Git repository root.
- Respect `.gitignore` and a FLUX ignore file if introduced.
- Build a lightweight repository map from file paths and project manifests.
- Provide file listing, text search, file reads, and bounded context selection.
- Exclude secrets, generated artifacts, dependency folders, binaries, and large files from automatic context unless explicitly requested.
- Do not require embeddings/vector search for V1. Add them only if a measured use case justifies the complexity.

### 4.5 Coding tools

Minimum built-in tools:

- `list_files`
- `search_text`
- `read_file`
- `write_file`
- `apply_patch`
- `run_command`
- `git_status`
- `git_diff`
- `git_log`

Tool calls must be schema-validated and bounded. File operations must validate paths remain inside the selected workspace unless the user explicitly approves an external path. Shell commands must run with timeout and output limits.

### 4.6 Agent loop and delegation

- Main FLUX agent owns the conversation and task lifecycle.
- V1 includes a small set of specialist agent profiles: Explore/Investigator, Planner, Implementer, Reviewer, and Tester. These may be implemented as configured roles over the same runtime rather than separate services.
- The main agent may delegate bounded subtasks and receive structured results.
- Subagents must have task scope, allowed tools, context budget, maximum steps, and a clear completion condition.
- Subagents must not merge or approve their own work.
- Show active agent, assigned task, status, and result in the TUI.
- Limit concurrent agents by default and make the limit configurable.

### 4.7 Permissions and human control

- Read-only inspection can be allowed by default.
- File writes, patches, shell commands, network access, and destructive Git operations must follow explicit permission policy.
- First run should use a safe permission mode with approval for writes and shell execution.
- Offer a per-session option to trust selected safe commands; never silently enable unrestricted shell execution.
- Never run destructive operations such as `git reset --hard`, deleting broad directories, force-pushing, or modifying global configuration without explicit user approval.
- The original repository must remain recoverable. Prefer a Git worktree or clearly isolated change area where practical.

### 4.8 Diff, tests, and verification

- Show changed files and unified diffs.
- Allow the user to inspect, approve, reject, or ask for revision.
- Allow tests, lint, type-check, and build commands to be run with explicit command visibility.
- Capture command, exit code, duration, bounded output, and working directory.
- Report verification as passed, failed, skipped, or inconclusive. Do not claim a fix is proven merely because the model says so.
- V1 verification evidence should be reproducible from the saved session/task record.

### 4.9 Sessions and persistence

- Save conversations, task state, tool summaries, and agent results locally.
- Resume a previous session from the TUI or a CLI command.
- Store data in a per-user FLUX directory, not inside the target repository by default.
- Provide a clear way to list and remove local sessions.

## 5. Non-functional requirements

- Windows 11 x64 is the first-class development/test target; avoid designs that prevent Linux/macOS support.
- Startup should be responsive; show progress for indexing or provider checks.
- Streaming output should appear incrementally.
- Errors must be actionable and visible in the TUI.
- The application must shut down cleanly and restore terminal state after errors or Ctrl+C.
- No telemetry by default. Any future telemetry must be opt-in and documented.
- Do not log secrets, full environment variables, or file contents unnecessarily.
- Keep the V1 architecture modular but avoid unnecessary distributed services.

## 6. V1 acceptance criteria

V1 is ready for release only when all of these are demonstrated on a clean Windows 11 environment:

1. `flux --version`, `flux doctor`, and `flux` run successfully after installation.
2. First-run setup can connect a verified compatible provider without editing source files.
3. A user can configure at least two distinct provider profiles (for example, one hosted OpenAI-compatible endpoint and one local OpenAI-compatible gateway), test them, and switch between them without losing the current session.
4. FLUX can stream a response in the TUI and display the active provider/model.
5. Main and specialist agent roles can use inherited defaults or explicit per-role provider/model overrides.
6. A configured fallback chain is tested with mocked quota/rate-limit and transient-failure cases; fallback is visible and must not duplicate tool execution.
7. Usage tracking displays provider-reported token counts when available and labels estimates clearly; configured budgets warn and enforce limits safely.
8. FLUX can inspect a repository and answer a codebase question with file references.
9. FLUX can propose a plan and wait for approval before making a change.
10. FLUX can edit at least one real file through its patch/write tool and display the diff.
11. FLUX can run a test command, capture the exit status, and report the result accurately.
12. FLUX can invoke at least one bounded subagent and display its lifecycle/result.
13. A user can resume a saved session.
14. Mouse and keyboard workflows both work; terminal resize does not corrupt the UI.
15. Automated tests cover provider routing/fallback/budget logic, permission checks, path safety, patch application, session persistence, and core state transitions.
16. README documents installation, setup, usage, provider switching, usage/budgets, safety, limitations, and troubleshooting.

## 7. Explicitly out of scope for V1

- Web dashboard or hosted cloud service.
- Team accounts, shared remote sessions, or billing.
- Plugin marketplace.
- Full IDE/editor replacement.
- Autonomous background daemon that edits repositories without supervision.
- Distributed agent orchestration infrastructure.
- Mandatory vector database or embeddings pipeline.
- Native adapters for every vendor API; V1 focuses on OpenAI-compatible endpoints and verified capabilities.
- Herdr as an end-user runtime dependency.

## 8. Design references and reuse policy

Study the interaction and architecture of OpenCode, OpenTUI, and Herdr. Reuse a library or code only after checking its current license, dependency health, platform support, and compatibility. Prefer using OpenTUI as the TUI library and public APIs/interfaces over copying whole applications. Preserve required license notices and attribution. Do not copy proprietary branding, assets, prompts, or protected design elements. Document any borrowed code and its license in `THIRD_PARTY_NOTICES.md`.

## 9. Release definition

The V1 release is an installable CLI package with a `flux` executable, onboarding, a working terminal coding agent, safe tools, diff review, limited subagents, and local session persistence. A beautiful screen without a working coding loop is not a release.
