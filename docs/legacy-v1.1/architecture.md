# FLUX V1 — Technical Architecture

**Status:** Proposed implementation architecture  
**Primary goal:** A reliable installable terminal coding agent, not a distributed platform.

## 1. Architectural decisions

| Area | V1 decision | Reason |
|---|---|---|
| Product form | Installable CLI + interactive TUI | Fast terminal-first setup and use |
| TUI | OpenTUI with React bindings, subject to Windows spike | Native terminal rendering with mouse and keyboard interaction |
| Runtime | Bun + TypeScript | OpenTUI's documented primary runtime and shared language |
| App architecture | Modular monolith | Simpler packaging, debugging, and release |
| Model protocol | Provider registry + normalized OpenAI-compatible adapter in V1 | Keep models/provider replaceable and support cloud/local endpoints |
| Persistence | SQLite through Bun's supported SQLite API, behind repository interfaces | Durable sessions, provider metadata, usage ledger, and task history |
| Streaming/events | In-process typed event bus | No local HTTP server required for the MVP |
| Repository access | Filesystem + Git CLI | Transparent, portable developer tools |
| Search | ripgrep when available, with a portable fallback | Fast repository search without a vector database |
| Agent execution | Main agent loop + bounded specialist roles | Useful delegation without complex infrastructure |
| Safety | Central permission policy + path validation + command allowlist/approval | Prevent unreviewed destructive changes |
| Verification | Explicit command runner and recorded results | Evidence-based reporting |

**Runtime caveat:** Current OpenTUI documentation lists Bun 1.3.14+ (with platform-specific notes) and Node.js 26.4+ for its supported Node path. Use Bun for V1 unless the spike finds a concrete blocker. Verify the installed runtime and Windows x64 native package before committing. Do not silently downgrade to an unsupported runtime. See https://opentui.com/docs/getting-started/runtime-support/.

## 2. System context

```text
                         ┌──────────────────────────────┐
                         │       Developer (User)       │
                         └──────────────┬───────────────┘
                                        │ mouse / keyboard
                         ┌──────────────▼───────────────┐
                         │       FLUX CLI + TUI         │
                         │  OpenTUI / React / Bun       │
                         └──────────────┬───────────────┘
                                        │ typed application events
                         ┌──────────────▼───────────────┐
                         │       Application Core      │
                         │ sessions · tasks · budgets  │
                         │ permissions · events        │
                         └───────┬────────────┬─────────┘
                                 │            │
                      ┌──────────▼───┐   ┌────▼────────────────┐
                      │ Agent Runtime│   │ Repository Services │
                      │ main + roles │   │ fs / search / git   │
                      └──────┬───────┘   └────┬────────────────┘
                             │                │
                    ┌────────▼────────────────▼───────┐
                    │ Provider Registry + Model Router│
                    │ role overrides · capabilities   │
                    │ fallback · usage · budgets      │
                    └──────────────┬─────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │ OpenAI-compatible provider      │
                    │ adapter(s)                      │
                    └───────┬───────────────┬─────────┘
                            │               │
              ┌─────────────▼────┐  ┌───────▼────────────────┐
              │ Hosted endpoint  │  │ Local endpoint/gateway │
              │ e.g. BharatCode  │  │ e.g. OmniRoute, Ollama │
              │ or custom API    │  │ or LM Studio           │
              └──────────────────┘  └────────────────────────┘

                    ┌─────────────────────────────┐
                    │ Local SQLite database      │
                    │ sessions · provider metadata│
                    │ usage · tasks · evidence   │
                    └─────────────────────────────┘
```



## 3. Runtime and package layout

Use a Bun workspace monorepo. Keep package boundaries logical, not excessive.

```text
flux/
├─ apps/
│  └─ cli/
│     ├─ src/
│     │  ├─ commands/
│     │  ├─ entry.ts
│     │  └─ bootstrap.ts
│     └─ package.json
├─ packages/
│  ├─ tui/                 # OpenTUI views, components, focus, keybindings
│  ├─ app-core/            # session/task orchestration and typed events
│  ├─ agent-runtime/       # model loop, tools, bounded subagents
│  ├─ providers/           # registry, model router, fallback manager, adapters
│  ├─ tools/               # filesystem, search, patch, shell, git, tests
│  ├─ permissions/         # policy evaluation, approval requests
│  ├─ repository/          # repo map, ignore rules, context selection
│  ├─ persistence/         # SQLite schema, sessions, provider metadata, usage ledger
│  └─ shared/              # schemas, types, errors, utilities
├─ docs/
├─ tests/
├─ scripts/
├─ package.json
├─ bunfig.toml
├─ tsconfig.json
└─ README.md
```

Avoid introducing Fastify, a local HTTP server, Redis, Docker orchestration, or a distributed task queue for V1. A typed in-process event bus is sufficient. Keep interfaces clean so a server/API can be added later if justified.

## 4. Major modules

### 4.1 CLI bootstrap

Responsibilities:
- Parse commands and flags.
- Resolve the current working directory and user configuration directory.
- Run `doctor` checks.
- Launch TUI or non-interactive commands.
- Expose `auth`, `providers`, `models`, and `usage` subcommands.
- Handle signals and guaranteed terminal cleanup.

### 4.2 TUI layer

Use `@opentui/core` and `@opentui/react` after validating the Windows environment. Keep rendering components separate from business logic.

Core views:
- AppShell
- SessionSidebar
- ConversationView
- Composer
- TaskPlanPanel
- AgentList / AgentDetail
- ToolCallCard
- ApprovalDialog
- DiffViewer
- VerificationPanel
- ProviderSetup / ProviderManager / ModelPicker
- AgentModelRouting / FallbackSettings / UsageBudgetPanel
- CommandPalette

Use a responsive layout policy: full sidebar + conversation + inspector on wide terminals; collapse the inspector/sidebar on narrower terminals. All actions must have keyboard equivalents. Build focus and selection behavior deliberately rather than relying only on mouse clicks.

### 4.3 Application core

Responsibilities:
- Session lifecycle.
- Task lifecycle and cancellation.
- Model request routing.
- Permission requests and approvals.
- Typed event publication for TUI updates.
- Persistence coordination.

Suggested task states: `queued`, `planning`, `awaiting_approval`, `running`, `verifying`, `completed`, `failed`, `cancelled`.

Suggested agent states: `idle`, `working`, `awaiting_approval`, `blocked`, `completed`, `failed`, `cancelled`.

### 4.3.1 Provider management and budget services

Keep this logic separate from the raw HTTP adapter:
- `ProviderRegistry`: CRUD for provider profile metadata and enabled state.
- `CredentialResolver`: resolves a credential reference from the OS keychain or an environment variable at request time; never returns secrets to UI state or logs.
- `ModelRouter`: resolves default/per-role overrides into a concrete provider/model target.
- `CapabilityCache`: stores verified model capabilities with timestamp/source and invalidates them when the profile/model changes.
- `FallbackManager`: classifies failures and applies only the user's configured fallback policy with partial-stream safeguards.
- `UsageLedger`: stores provider-reported usage and clearly labelled estimates.
- `BudgetManager`: evaluates per-task/session/agent limits and blocks/asks before starting a request when the known budget is exhausted.

The TUI must not contain provider secrets. It receives safe metadata (profile name, provider label, model ID, capability state, usage summaries, and error class) only.

### 4.4 Provider registry, model router, and adapters

Use a provider registry and provider-independent model router. Keep the first implementation deliberately focused on OpenAI-compatible chat-completions endpoints while making the interface extensible for future native adapters.

```ts
interface ProviderProfile {
  id: string;
  displayName: string;
  protocol: "openai-compatible";
  baseURL: string;
  credentialRef?: string; // reference to OS credential store or env var, never the secret itself
  enabled: boolean;
}

interface ModelCapabilities {
  streaming: "supported" | "unsupported" | "unknown";
  toolCalls: "supported" | "unsupported" | "unknown";
  structuredOutput: "supported" | "unsupported" | "unknown";
  cancellation: "supported" | "unsupported" | "unknown";
  usageReporting: "supported" | "unsupported" | "unknown";
  contextWindow?: number;
  maxOutputTokens?: number;
}

interface ModelTarget {
  providerProfileId: string;
  modelId: string;
  capabilities: ModelCapabilities;
}

interface ModelProvider {
  id: string;
  listModels?(profile: ProviderProfile): Promise<ModelInfo[]>;
  inspectCapabilities(profile: ProviderProfile, modelId: string): Promise<ModelCapabilities>;
  streamChat(profile: ProviderProfile, request: ChatRequest, signal?: AbortSignal): AsyncIterable<ModelEvent>;
}
```

Normalize provider-specific streaming, tool-call, token-usage, quota, and error shapes into internal types. Represent unknown capabilities as unknown; never infer them from a model name. Add timeouts, cancellation, redaction, and clear unsupported-capability errors.

**V1 endpoint support:**
- Verified BharatCode-compatible endpoint configuration.
- Generic custom OpenAI-compatible endpoints.
- Compatible local gateways/runtimes such as OmniRoute/LiteLLM, Ollama, and LM Studio when the configured endpoint supports the required API contract.
- No assumption that all named products expose identical endpoints or tool-call behavior. Verify the user's actual endpoint and model.

**Model routing:**
- A default provider/model is selected for the main agent.
- Each role (`main`, `explore`, `planner`, `implementer`, `reviewer`, `tester`) may inherit the default or specify a provider/model override.
- Runtime requests resolve to a concrete `ModelTarget` before execution. The TUI shows the selected target for every agent.
- A session can switch models without dropping task/session state.

**Fallback manager:**
- Users configure an ordered fallback chain globally or per role; local models can be included as a fallback.
- Automatic fallback is opt-in and allowed only for classified quota/rate-limit or transient service/network failures before any partial response/tool event is accepted.
- Never automatically fallback for invalid credentials, permissions, malformed requests, or unsupported capabilities.
- Never replay a partially streamed tool request silently. If a stream has emitted partial text or tool-call fragments, mark it interrupted and require safe recovery; do not risk duplicate tool execution.
- FLUX owns tool execution. A provider retry must never execute a tool twice. Use request/operation IDs and persist tool execution state before dispatch.
- Explain the provider failure and selected fallback in the TUI. Never silently switch to a paid endpoint.

**Usage ledger and budgets:**
- Normalize provider-reported input/output/total token usage and request metadata into usage events.
- Persist usage per request, provider, model, session, task, and agent. Track requests even when token usage is unavailable.
- Mark every usage value as provider-reported or estimated. Do not label estimates as exact.
- Track configured per-task and per-session budgets, with optional per-agent limits. Where exact provider usage is available, enforce token budgets. Where it is unavailable, enforce request counts and maximum output limits and label token tracking as approximate.
- Warn before limits; block or ask for approval at hard limits. Never switch to paid providers without explicit user configuration.
- Show provider quota/reset details only if the provider explicitly returns them. Do not infer allowance or reset time.
- Cost estimates are optional and only enabled when pricing is user-supplied or verified with source/date metadata. Do not imply local inference is universally free.

Use the team's existing known-good BharatCode configuration as one integration test target, but do not assume it is always available or has free quota. Inspect the working OpenCode provider config locally and extract only non-secret settings. Do not copy API keys into source, docs, logs, or shared collaboration files. Do not assume a URL or model ID; verify it against the actual configuration and provider contract.

Credential storage is separated from provider metadata. Prefer an OS credential store; allow environment-variable references for headless use. Never persist plaintext API keys in project config, SQLite, transcripts, or logs. Do not automatically copy credentials from OpenCode, Claude Code, or OmniRoute into FLUX.

The adapter must test streaming, tool calls, cancellation/timeouts, and usage reporting. If the selected model cannot reliably call tools, show a capability warning and do not execute unvalidated free-form commands from model text.

### 4.5 Agent runtime

A single runtime should support role profiles with:
- system instructions;
- model selection/override;
- allowed tools;
- max steps;
- context/token budget;
- timeout;
- output schema;
- delegation policy.

Initial roles:
- `main`: owns conversation and orchestrates work.
- `explore`: read-only repository analysis.
- `planner`: creates a plan and risk assessment.
- `implementer`: edits within approved scope.
- `reviewer`: inspects diff and potential regressions.
- `tester`: selects and executes verification commands.

For V1, roles can reuse the same provider/runtime. Keep subagent calls bounded, pass only relevant context, and return structured summaries rather than dumping all transcripts into the parent context.

### 4.6 Tool layer

Every tool has a typed input schema, typed result, policy classification, timeout, output cap, and audit event.

| Tool | Default policy | Notes |
|---|---|---|
| list/search/read | allow inside workspace | Respect ignore rules and file size limits |
| write/patch | ask | Show target path and diff before applying when feasible |
| shell command | ask | Show command, cwd, timeout, and output cap |
| git status/diff/log | allow | Read-only |
| git checkout/worktree | ask or controlled internal operation | Never destroy user work |
| git reset/clean/push/commit | deny or explicit user approval | High-impact operations |

All path inputs must be canonicalized and checked against workspace boundaries. Avoid shell string concatenation; use argument arrays where possible. When shell execution is unavoidable, record the exact command and working directory and apply a timeout.

### 4.7 Repository context

V1 retrieval strategy:
1. Discover repo root and project manifests.
2. Build a bounded file tree using ignore rules.
3. Search text with ripgrep if present; provide a fallback.
4. Read only selected files/ranges.
5. Track context provenance and file references in the response.

Do not recursively load the entire repository into the prompt. Do not index `.env`, credentials, certificates, private keys, or typical secret files. No mandatory embeddings/vector DB for V1.

### 4.8 Persistence

Use SQLite behind repository interfaces. Store:
- sessions and messages;
- task/agent metadata and state transitions;
- tool call summaries and approval decisions;
- patch metadata and verification runs;
- provider profile metadata, provider references, model IDs, capability snapshots, role overrides, fallback configuration (never API keys in plaintext DB rows);
- normalized usage ledger events, including reported/estimated status, token counts when available, request counts, timestamps, session/task/agent attribution, and configured budget state.

Use migrations and schema versioning. Keep the database under a per-user FLUX data directory. Store large outputs as bounded external files only if necessary, with safe retention/cleanup behavior.

### 4.9 Installation and configuration

V1 development uses Bun. The release target is a package exposing the `flux` executable and install instructions. Start with local workspace execution and `bun link`; verify global installation on Windows before calling packaging complete. Publish only after package scope/name ownership, license, native dependency packaging, and clean-machine installation are checked.

Configuration precedence should be documented and deterministic:
1. CLI flags;
2. environment variables;
3. project-level non-secret `.flux/config.json` (optional, committed-safe only);
4. user-level configuration under the OS user config directory.

Keep secrets in an OS-appropriate credential store when available; otherwise resolve from environment variables at runtime. Never place secrets in project-level config, SQLite, transcripts, or logs. Provider profiles and role-routing choices live in user-level configuration by default. Provide `flux auth`, `flux providers`, `flux models`, `flux usage`, and `flux doctor`.

## 5. Herdr development-team topology (not part of FLUX runtime)

Herdr is the development team's terminal orchestration environment. It runs separate terminal panes and can recognize OpenCode and Claude Code. Install integrations when appropriate:

```powershell
herdr integration install opencode
herdr integration install claude
```

OpenCode is the lead developer and uses the already-working BharatCode model configuration. Claude Code uses the existing local model route through OmniRoute. Verify the actual effective model/provider before coding; do not change global agent configs or leak credentials.

OpenCode may use its native subagents and may launch additional Claude Code sessions through Herdr's supported agent automation. A pane must exist before `herdr agent start`; use Herdr's own CLI help/docs to create/split panes and capture returned pane IDs rather than guessing IDs. Use `herdr agent prompt`, `herdr agent wait`, and `herdr agent read` where supported instead of blindly injecting keystrokes.

### Shared communication contract

`agent_handoff.md` is the only shared file-based communication channel between the primary OpenCode and Claude Code sessions. It contains assignments, decisions, progress, blockers, and handoffs. OpenCode owns final task assignment, decision, and integration status. Claude writes only within the Claude response/handoff area and must avoid rewriting OpenCode's sections. For multiple Claude child agents, OpenCode collects their outputs via Herdr and records a concise summary in the shared file. Avoid simultaneous edits to the same source files; use isolated Git worktrees or strictly disjoint file ownership.

## 6. Error handling and observability

- Typed error categories: provider/auth, quota exhausted, rate limit, budget exhausted, network, unsupported capability, tool validation, permission denied, path denied, command timeout, parse/contract error, persistence error, TUI/runtime error.
- Every operation receives a correlation ID.
- Show concise, actionable errors in the TUI; store bounded diagnostics locally.
- Redact API keys, authorization headers, environment secrets, and credential-like strings.
- Cancellation must propagate to active model requests and shell processes where supported.

## 7. Testing strategy

- Unit tests: provider normalization, capability detection, routing/role overrides, fallback classification and no-duplicate-tool guarantees, usage aggregation/estimation labels, budget enforcement, credential redaction, schemas, path validation, permission policy, state machines, context filters.
- Integration tests: mocked multiple-provider streams and tool calls, provider switching, local-gateway configuration, simulated quota/rate-limit/network failures, fallback with partial-stream safeguards, usage/budget persistence, credential redaction, SQLite persistence, Git operations in temporary repos, patch application, command timeout.
- TUI tests: component/render snapshots or in-memory render tests where supported; keyboard focus, mouse interactions, resize and terminal cleanup.
- End-to-end test: connect mocked provider, inspect fixture repo, apply a safe patch, run test command, display diff, resume session.
- Windows manual verification: PowerShell, Windows Terminal, mouse, UTF-8, resize, Ctrl+C cleanup, package install/uninstall.

## 8. Open questions to resolve during spike (do not block all implementation)

1. Does current OpenTUI React render and handle mouse events reliably in the user's Windows Terminal/PowerShell setup?
2. Which exact OpenTUI version and Bun version are compatible with the user's Windows machine?
3. Does the currently configured BharatCode endpoint support streaming tool calls required by the agent loop?
4. What exact installation/package name is available and owned by the project maintainer?
5. Which secure credential-store integration is least fragile on Windows and cross-platform?
6. Which provider usage fields and quota headers are actually exposed by each tested endpoint, and which must remain unknown?

Resolve these with a short spike and record decisions in `agent_handoff.md`.

## 9. Reference links

- OpenTUI docs: https://opentui.com/docs/
- OpenTUI runtime support: https://opentui.com/docs/getting-started/runtime-support/
- OpenTUI React bindings: https://opentui.com/docs/bindings/react/
- OpenCode agents docs: https://docs.dev.opencode.ai/docs/agents/
- Herdr agent docs: https://herdr.dev/tui/docs/agents/
- Herdr agent automation: https://herdr.dev/tui/docs/agent-automation/
- Herdr integrations: https://herdr.dev/tui/docs/integrations/
