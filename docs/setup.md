# Setup and providers

This page covers installation, first-run configuration, provider profiles, model
routing, fallback and budgets. For the safety model see
[safety.md](safety.md); for failures see [troubleshooting.md](troubleshooting.md).

FLUX is a local application. It has no account system, no telemetry and no
bundled credentials. Provider metadata lives in your user config; secrets are
read from environment variables at request time and are never written by FLUX.

---

## 1. Before you start

| Requirement | Details |
|---|---|
| Bun **>= 1.3.14** | Required by the OpenTUI native renderer. Verified with Bun 1.4.x on Windows 11 x64. |
| Git | Required for repository detection and the Git tools. |
| ripgrep | Optional. Used for fast search when present; a TypeScript walker is the fallback. |
| A real terminal | The TUI needs an interactive TTY with ANSI support. Windows Terminal is recommended. |
| One OpenAI-compatible endpoint | A hosted gateway or a local server such as Ollama, LM Studio or LiteLLM. |

Check the versions you actually have:

```sh
bun --version
git --version
rg --version        # optional
```

If Bun is too old, install the current release from <https://bun.sh> before
continuing. `flux doctor` reports the exact minimum and fails on an old runtime.

---

## 2. Install from this checkout

FLUX is not published. Install from the repository for now.

```sh
cd /path/to/FLUX
bun install
bun link
```

`bun link` makes the workspace `flux` binary available through Bun's global bin
directory. Confirm it is on `PATH`:

```sh
bun pm bin -g     # prints the global bin directory
flux --version
```

If `flux` is not found, add the printed directory to `PATH` (see
[troubleshooting.md](troubleshooting.md#flux-is-not-found-after-bun-link)).

You can also run without linking:

```sh
bun run apps/cli/src/entry.ts --version
bun run flux -- --version
```

### Refresh after pulling changes

```sh
bun install
bun link          # only needed if the bin or workspace layout changed
```

---

## 3. Verify the installation

```sh
flux doctor
```

`doctor` checks the Bun version, OS, Git, optional ripgrep, user config, SQLite
schema, repository root, provider profiles, default model, permission mode,
fallback, budgets and the OpenTUI native package. Fatal failures set a non-zero
exit code; warnings do not.

Machine-readable output:

```sh
flux doctor --json
```

A brand-new install may report warnings such as "none configured" for providers
and "not selected" for the default model. That is expected until step 4.

---

## 4. Connect a provider

### Guided flow

```sh
flux auth
```

It asks for a profile name, base URL, one or more model IDs and an optional
credential environment-variable name, then offers one minimal live probe. It
never asks for the secret itself.

### Non-interactive flow

```sh
flux providers add \
  --name "<display name>" \
  --url "<base URL>" \
  --model "<model-id>[,<model-id>...]" \
  [--env API_KEY_VARIABLE] \
  [--id custom-id]
```

The provider ID is a slug of the display name unless you pass `--id`. The first
model becomes the default model if none is configured yet.

### Local endpoint (no credential)

Example with Ollama:

```sh
flux providers add \
  --name Ollama \
  --url http://127.0.0.1:11434/v1 \
  --model qwen35-9b-32k:latest

flux providers test ollama
flux models use ollama qwen35-9b-32k:latest
```

Local endpoints usually need no key. Use the OpenAI-compatible base URL that
ends in `/v1`, not the Ollama web UI port. Make sure the model is already pulled
in Ollama before testing.

### Hosted endpoint (environment credential)

```sh
flux providers add \
  --name "My Gateway" \
  --url https://gateway.example.com/v1 \
  --model my-model \
  --env MY_GATEWAY_API_KEY
```

FLUX stores only the reference `env:MY_GATEWAY_API_KEY`. Set the value in the
same shell that launches FLUX:

```powershell
# PowerShell — current session
$env:MY_GATEWAY_API_KEY = "…"

# PowerShell — persist for your user (new terminals only)
[Environment]::SetEnvironmentVariable("MY_GATEWAY_API_KEY", "…", "User")
```

```sh
# POSIX shell
export MY_GATEWAY_API_KEY="…"
```

Then test:

```sh
flux providers test my-gateway
```

Never pass a raw key to `providers add`. Config validation rejects anything that
is not `env:VARIABLE_NAME`, and doctor/list output shows only the reference.

### Provider commands

```sh
flux providers list
flux providers test <id> [--model <model>]
flux providers models <id>        # queries the endpoint's /models
flux providers default <id> <model>
flux providers enable <id>
flux providers disable <id>       # keep the profile, stop routing to it
flux providers remove <id>        # cannot remove the current default provider
```

---

## 5. Model selection

A model reference is a pair: provider profile ID plus model ID.

```sh
flux models list
flux models use <provider> <model>                 # default for all roles
flux models role reviewer <provider> <model>       # per-role override
flux models role reviewer clear                    # inherit the default again
```

Roles: `main`, `explore`, `planner`, `implementer`, `reviewer`, `tester`.

- `main` drives normal interactive and `flux run` work and may delegate.
- `explore`, `planner`, `reviewer` and `tester` are bounded specialists.
- `implementer` can edit but cannot delegate.
- A role without an override inherits the default model.

### Capabilities are verified, not assumed

`flux providers test <id>` sends exactly one small streaming request that asks
for `READY` and includes a probe tool. It records only what the endpoint
demonstrates:

| Field | Marked `supported` when… |
|---|---|
| `streaming` | the endpoint emitted at least one text delta |
| `toolCalls` | the endpoint emitted a tool-call event |
| `usageReporting` | the endpoint emitted a usage event |
| `cancellation` | the client can abort the request (always supported) |
| `structuredOutput` | never inferred; stays `unknown` |

`unknown` is not a failure. It means "not demonstrated by this probe". FLUX will
not invent pricing, context limits, quota or capabilities from a model name.

If an endpoint does not implement `/models`, pass `--model` when testing and add
the model IDs explicitly with `providers add`.

---

## 6. Opt-in fallback

Fallback is **off by default**. Enabling it never silently moves work to a paid
provider: the destination is a model you add to the chain.

```sh
flux models fallback add <provider> <model>
flux models fallback add <provider> <model> --role tester
flux models fallback on
flux models fallback list
flux models fallback off
flux models fallback clear                 # clear the global chain
flux models fallback clear --role tester   # clear one role chain
flux models fallback reset                 # clear all chains and disable
```

Fallback is attempted only when all of these hold:

1. fallback is enabled for the run (config or the TUI's `Ctrl+F`);
2. the primary fails with `quota-exhausted`, `rate-limit`, `network` or
   `transient`;
3. the error is retryable;
4. **no** text, reasoning or tool call has been accepted from the primary yet.

Auth errors, malformed requests, missing endpoints and unsupported capabilities
surface immediately instead of being retried elsewhere. An accepted stream is
never replayed, and tool calls are de-duplicated by ID so a retry cannot execute
a tool twice. The TUI and CLI both display `from → to` plus the reason.

The TUI toggle applies to the current session only; it does not change the saved
config.

---

## 7. Budgets

Budgets are optional and configured in the user config under `budgets`:

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

| Field | Scope |
|---|---|
| `sessionTokens` / `sessionRequests` | total for one session |
| `taskTokens` / `taskRequests` | one user turn/task |
| `agentTokens` | one agent (including a subagent) |
| `warnAtRatio` | warn threshold, `0.1`–`0.99` |

At the warning ratio FLUX emits a warning. At a hard limit it stops the run with
`budget-exhausted`; it does not switch providers to keep going. Raise the limit
or start a new session.

Inspect usage at any time:

```sh
flux usage
flux usage --session <session-id>
flux usage --json
```

Provider-reported usage is labelled `provider`. When the endpoint reports
nothing, FLUX falls back to a `char/4` estimate and labels it `estimated`. The two
are never mixed without saying so.

---

## 8. Project-level config (optional)

A repository may contain `.flux/config.json` to select models, roles, fallback,
budgets and UI settings for that project:

```json
{
  "defaultModel": { "providerProfileId": "ollama", "modelId": "qwen35-9b-32k:latest" },
  "roles": {
    "reviewer": { "providerProfileId": "ollama", "modelId": "qwen35-9b-20k:latest" }
  },
  "budgets": { "taskTokens": 40000 }
}
```

Rules:

- Project config is merged over the user config.
- It may **not** define `providers` or credentials. A project file containing
  `providers` is rejected when loaded.
- Referenced provider profiles must already exist in your user config.
- FLUX reads the project file from the current workspace only; it does not walk
  ancestors looking for one.

User config is authoritative for secrets and provider profiles. Do not commit
machine-specific keys anywhere.

---

## 9. Headless use

The TUI needs a TTY. For scripts, CI or piped output use `flux run`:

```sh
flux run "Explain how authentication is wired in this repo" --read-only
flux run "Run the test suite and report the real result" --yes
flux run "Summarize the last change" --session <session-id> --json
```

| Flag | Effect |
|---|---|
| `--session <id>` | Continue an existing session |
| `--yes` / `-y` | Approve writes and commands for this run only |
| `--read-only` | Deny all writes and commands |
| `--accept-edits` | Approve non-destructive writes/commands for this run |
| `--role <role>` | Run as a specialist role |
| `--max-steps <n>` | Bound the agent loop |
| `--json` | One JSON object with session, result, usage, budget and events |

`--yes` is an explicit opt-in, not a default. Destructive commands are still
denied in every mode. Non-zero exit code means the turn did not complete
successfully.

---

## 10. Data locations and environment

| Item | Windows | Linux / macOS |
|---|---|---|
| Home directory | `%APPDATA%\flux` | `${XDG_CONFIG_HOME:-~/.config}/flux` |
| Config | `<home>\config.json` | `<home>/config.json` |
| Database | `<home>\flux.sqlite` | `<home>/flux.sqlite` |

- `FLUX_HOME=<dir>` overrides the home directory. Use it for portable installs,
  tests and demos.
- `config.json` stores non-secret metadata only.
- `flux.sqlite` stores sessions, messages, tasks, tool calls, approvals,
  verification evidence and usage.
- Sessions are user-scoped, not written into the target repository.

Back up the whole home directory to preserve history. Deleting
`flux.sqlite` deletes sessions and usage; deleting `config.json` deletes provider
profiles (but not environment credentials).

---

## 11. Updating and removing

```sh
# update
cd /path/to/FLUX
git pull
bun install
bun link

# remove the global link (from the checkout)
bun unlink
```

Uninstalling the link does not delete your config or session database. Remove the
home directory manually if you want a clean slate.

---

## 12. Next steps

- Read [safety.md](safety.md) before granting approvals in a real repository.
- Read [troubleshooting.md](troubleshooting.md) if a check fails.
- See the TUI key map and command reference in the top-level [README.md](../README.md).
