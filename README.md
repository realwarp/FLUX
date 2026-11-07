# FLUX

A terminal-native AI coding agent with a mouse-first hybrid TUI, multi-provider
routing, safe repository tools, verification evidence and local session history.

FLUX is an independent application. It is not a wrapper around OpenCode, Claude
Code or Herdr, and it does not read their credentials.

> **Status:** V1 MVP, built and verified locally on Windows 11 x64 with Bun. The
> package name and publishing scope are intentionally undecided; install from
> this checkout for now.

---

## What it does

- Ask FLUX to inspect a repository, explain code, plan a change, edit files, run
  tests and review the result.
- Stream responses in a hybrid TUI with a session sidebar, live agent activity,
  approval dialogs, an inspector and a multiline composer.
- Save multiple OpenAI-compatible provider profiles (hosted or local), choose a
  default model, and override models per agent role.
- Opt into a visible fallback chain for quota/rate-limit/transient/network
  failures, without replaying partial output or duplicate tool calls.
- Track provider-reported usage separately from estimates, with configurable
  session/task/agent budgets.
- Persist sessions, tool calls, approvals, verification evidence and usage in
  local SQLite.

## Requirements

| Requirement | Notes |
|---|---|
| Bun | **>= 1.3.14** (OpenTUI native renderer). Verified with Bun 1.4.4. |
| OS | Windows 11 x64 is the primary target. Linux/macOS are intended to work. |
| Git | Required for repository detection and the Git tools. |
| ripgrep | Optional; used when present, with a TypeScript fallback. |
| Terminal | A real TTY with ANSI support. Windows Terminal is recommended. |

No telemetry. No account. No cloud service.

---

## Install from this checkout

```sh
cd /path/to/FLUX
bun install
bun link
flux --version
```

`bun link` links the workspace `flux` bin into your Bun global bin directory.
Alternatively, run it without linking:

```sh
bun run apps/cli/src/entry.ts --version
# or
bun run flux -- --version
```

If `flux` is not found after `bun link`, add Bun's global bin directory to
`PATH` (`bun pm bin -g` prints it).

> Do not publish under an assumed package name. Verify name ownership first.

---

## Quick start

```sh
# 1. Check your environment, config, providers and Git.
flux doctor

# 2. Connect a provider. This stores only a credential *reference*.
flux providers add \
  --name Ollama \
  --url http://127.0.0.1:11434/v1 \
  --model qwen35-9b-32k:latest

# 3. Verify the endpoint with one minimal capability probe.
flux providers test ollama

# 4. Choose the default model (usually automatic after add).
flux models use ollama qwen35-9b-32k:latest

# 5. Launch the TUI inside a repository.
flux
```

For a hosted OpenAI-compatible endpoint, pass an environment variable name:

```sh
flux providers add \
  --name "My Gateway" \
  --url https://gateway.example.com/v1 \
  --model my-model \
  --env MY_GATEWAY_API_KEY

# Set the variable in your shell; FLUX never stores the secret.
export MY_GATEWAY_API_KEY="…"      # PowerShell: $env:MY_GATEWAY_API_KEY = "…"
flux providers test my-gateway
```

The interactive guided flow is `flux auth`. It asks for a name, base URL, model
IDs and an optional credential environment variable, then offers one live probe.

### Headless / one-shot use

```sh
flux run "Explain how authentication is wired in this repo" --read-only
flux run "Run the test suite and report the real result" --yes
flux run "Summarize the last change" --session <session-id> --json
```

`--read-only` denies all writes and commands. `--yes` approves writes and
commands for that non-interactive run only, and destructive commands are still
denied.

---

## Command reference

| Command | Purpose |
|---|---|
| `flux` | Launch the TUI in the current directory. |
| `flux resume <session-id>` | Resume a saved session in the TUI. |
| `flux run "<prompt>"` | Run one non-interactive turn. |
| `flux doctor [--json]` | Check runtime, config, providers, Git, budgets and native deps. |
| `flux auth` | Guided provider setup. |
| `flux providers` | `list`, `add`, `test`, `enable`, `disable`, `remove`, `models`, `default`. |
| `flux models` | `list`, `use <p> <m>`, `role <role> <p> <m>`, `fallback …`. |
| `flux usage [--json]` | Token/request usage and budget status. |
| `flux sessions` | `list`, `show <id>`, `delete <id>`. |
| `flux --version`, `flux --help` | Version and help. |

Common flags: `--session <id>`, `--yes`, `--read-only`, `--accept-edits`,
`--max-steps <n>`, `--json`, `--role <role>`.

---

## Providers and model switching

Provider profiles live in the user config, never in the repository. Each profile
records a name, base URL, model IDs, optional credential reference and verified
capabilities. `flux providers test <id>` sends exactly one minimal request and
records only what the endpoint demonstrates; capabilities are never inferred
from a model name.

```sh
flux providers list
flux providers test ollama
flux providers disable openrouter        # keep the profile, stop routing to it
flux providers enable openrouter
flux providers remove openrouter
flux models use ollama qwen35-9b-32k:latest
```

Switch providers/models at any time; sessions and task state are stored
separately from the active route and are not lost.

### Per-role overrides

The roles are `main`, `explore`, `planner`, `implementer`, `reviewer`, `tester`.

```sh
flux models role reviewer ollama qwen35-9b-32k:latest
flux models role tester   ollama qwen35-9b-20k:latest
flux models role reviewer clear      # inherit the default again
flux models list                     # capabilities, default and role assignment
```

Specialist agents are bounded: read-only roles cannot write, the tester can only
read plus run commands, nested delegation is rejected, and each run has a step
limit.

## Opt-in fallback

Fallback is **off by default**. When enabled it only happens for classified
`quota-exhausted`, `rate-limit`, `network` or `transient` failures, and only
before any text, reasoning or tool-call output has been accepted. Auth errors,
malformed requests and unsupported capabilities surface immediately. An accepted
stream is never replayed, and tool calls are de-duplicated by id so a retry
cannot execute a tool twice.

```sh
flux models fallback add ollama qwen35-9b-20k:latest
flux models fallback add local-qwen qwen3:8b --role tester
flux models fallback on
flux models fallback list
flux models fallback off
flux models fallback clear --role tester
flux models fallback reset          # clear all chains and disable fallback
```

The TUI shows each fallback (`from → to`, with the reason) and lets you toggle it
for the current session with **Ctrl+F**. Fallback never silently switches to a
paid provider.

## Usage and budgets

`flux usage` shows request/token totals by provider and model. Provider-reported
usage is labelled `provider`; anything derived from the char/4 heuristic is
labelled `estimated` and is never presented as exact. FLUX shows quota/reset
information only when the provider actually reports it, and it does not guess
pricing or external allowances.

Budgets are configured in the user config (`budgets`):

```json
{
  "budgets": {
    "sessionTokens": 250000,
    "sessionRequests": 80,
    "taskTokens": 60000,
    "taskRequests": 20,
    "agentTokens": 30000,
    "warnAtRatio": 0.8
  }
}
```

FLUX warns at the configured ratio and hard-stops when a ceiling is reached
(`budget-exhausted`) rather than quietly switching providers. Raise the budget or
start a new session to continue.

---

## TUI tour

- **Header:** workspace, Git state and the active route.
- **Sidebar:** recent sessions (click to load), live agent states, new session,
  help.
- **Main area:** streamed assistant text, reasoning, tool calls/results, plans
  and verification notices.
- **Inspector:** task state, verification evidence, approved plan, edit count,
  provider list and the active budget.
- **Composer:** multiline prompt input.
- **Status bar:** running state, session id, budget, line count and hints.

| Key | Action |
|---|---|
| `Ctrl+Enter` / `Ctrl+J` | Send the prompt |
| `Tab` | Switch composer/sidebar focus |
| `Ctrl+C` | Cancel the current turn; press again when idle to quit |
| `Ctrl+N` | New session |
| `Ctrl+L` | Reload the current session from SQLite |
| `Ctrl+U` | Show session usage and budget status |
| `Ctrl+F` | Toggle fallback for this session |
| `F1` / `Esc` | Help / close overlays |
| `y` / `a` / `n` | Approve / always allow this command / reject a pending request |

Mouse: click sessions, buttons, approval actions and help overlays. The layout
collapses the sidebar below 66 columns and the inspector below 92 columns.

### Approval flow

Default mode is `ask`: reads are allowed; `write_file`, `apply_patch` and
`run_command` request approval with the exact path, command, patch or diff.
`always` trusts that exact command for the session. `read-only` denies all writes
and commands. `accept-edits` approves non-destructive writes/commands for the
session. Destructive patterns (`git reset --hard`, `git clean -f`, force-push,
broad recursive deletes, disk format, power control) are **always denied**,
including in `accept-edits` mode.

## Sessions and storage

- Default home: `%APPDATA%\flux` on Windows, `~/.config/flux` elsewhere.
- `FLUX_HOME=<dir>` overrides it for portable/test use.
- Files: `config.json` (non-secret metadata) and `flux.sqlite` (sessions,
  messages, tasks, tool calls, approvals, verification, usage).
- Sessions store the working directory, model selection and conversation, so
  `flux resume <id>` restores context.
- `flux sessions delete <id>` removes a session and its related rows.

Sessions are stored per user, not inside the target repository.

## Safety model

- Credentials are referenced as `env:VARIABLE_NAME` and resolved only at request
  time. Raw keys are rejected by config validation and redacted from errors.
- Project `.flux/config.json` may select model ids but may not define providers
  or credentials.
- Paths are resolved inside the workspace, including symlink targets; traversal
  is rejected. Credential-like files (`.env*`, `.npmrc`, `.netrc`, SSH keys,
  `*.pem`, `credentials.json`, …) are denied unless explicitly overridden.
- Shell commands run with a timeout (`120s` default, max `600s`) and bounded
  output; results carry exit code and duration.
- Tool calls are persisted before dispatch, which prevents blind replay after a
  crash or provider retry.
- No telemetry; no automatic import of OpenCode/Claude/OmniRoute credentials.

See [docs/safety.md](docs/safety.md) for the full policy.

## Verification evidence

Every `run_command` result is persisted as a `VerificationRecord` with the
command, working directory, exit code, duration, bounded output, truncation flag
and `passed`/`failed` status. The TUI inspector shows the latest result, and the
records can be reviewed from the session database. FLUX does not claim a fix is
proven just because the model says so.

## Development

```sh
bun install
bun x tsc --noEmit -p tsconfig.json    # strict typecheck
bun test                               # provider/fallback/budget/permissions/path/patch/persistence
bun run doctor                         # runtime + config health
```

Workspace layout:

```
apps/cli          command-line entry points
packages/shared   domain types, schemas, errors, redaction
packages/providers provider registry, OpenAI-compatible adapter, router, fallback, usage, budgets
packages/permissions central permission policy and approval handlers
packages/repository path safety, ignore rules, repository context
packages/tools    10 built-in tools, process runner, patch engine
packages/persistence SQLite schema and repositories
packages/agent-runtime agent loop, prompts, delegation, verification
packages/app-core  wiring, config, events
packages/tui       OpenTUI React interface and launcher
tests              automated coverage
```

## Limitations (V1)

- One active route per role at a time; switching means changing the configured
  default/override, not two providers in parallel.
- Credentials are environment-only. An OS credential-store adapter is not
  implemented yet; Windows Credential Manager is not used.
- Cost is not displayed because verified pricing metadata is not part of V1.
- Subagents are bounded and sequential; there is no parallel agent pool.
- TUI mouse behaviour depends on terminal support; keyboard paths always exist.
- The package is not published. Use the local checkout.
- The TUI requires a TTY; use `flux run` for scripts/CI.

## More documentation

- [Setup and providers](docs/setup.md)
- [Safety and permissions](docs/safety.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
- The V1 contract remains in `spec.md`, `architecture.md` and
  `implementation_plan.md`.
