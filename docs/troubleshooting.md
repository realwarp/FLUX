# Troubleshooting

Start with the built-in health check from the directory where you launch FLUX:

```sh
flux doctor
flux doctor --json
```

`doctor` exits non-zero only for blocking failures; warnings are advisory. The
JSON form is easier to attach to a report — but never attach API keys or a full
environment dump.

---

## Installation and runtime

### "Bun runtime … (OpenTUI needs >= 1.3.14)"

Your Bun is older than the native renderer requires.

```sh
bun --version
```

Install a current Bun from <https://bun.sh>, open a new terminal and re-run
`bun install`. `flux doctor` reports the exact version it found.

### `bunx` is not recognized

This environment does not expose `bunx` on `PATH`. Use the `bun x` form:

```sh
bun x tsc --noEmit -p tsconfig.json
```

### `flux` is not found after `bun link`

1. Confirm the link succeeded:

   ```sh
   bun link
   bun pm bin -g
   ```

2. Add the printed global bin directory to `PATH`.
   - PowerShell (current session):
     ```powershell
     $env:PATH = "$(bun pm bin -g);$env:PATH"
     ```
   - Or add it permanently through **System Properties → Environment Variables**.
3. Open a new terminal and run `flux --version`.

You can always run the checkout directly:

```sh
bun run apps/cli/src/entry.ts --version
```

### OpenTUI native package warning

```text
WARN  OpenTUI native package: @opentui/core-win32-x64 not found; run bun install with network access
```

The platform renderer was not installed. This is a warning, not a fatal check,
but the TUI cannot start without it.

```sh
bun install
flux doctor
```

Bun may place the platform package under `node_modules/.bun/` rather than
hoisting it to `node_modules/@opentui/`. Doctor resolves both layouts, so trust
`PASS` over the physical path. If it still fails, confirm you are online during
install and that your platform/architecture is supported.

### The TUI says it needs an interactive terminal

```text
The TUI needs an interactive terminal. Use `flux run "..."` for non-interactive use.
```

The TUI requires both stdin and stdout to be TTYs. This happens in CI, when
piping output, in some IDE task runners and inside non-interactive shells.

- Use a real terminal such as Windows Terminal.
- For scripts and CI use `flux run "…"`.
- Do not pipe `flux` through `tee`/`Out-File` if you expect the TUI.

### The TUI looks wrong, renders slowly or mouse clicks do nothing

- Use a modern terminal (Windows Terminal recommended). Legacy consoles may lack
  mouse/ANSI support.
- The layout adapts to width: the inspector collapses below **92 columns** and
  the sidebar below **66 columns**. Resize the window or maximize it.
- Mouse support depends on the terminal; every mouse action has a keyboard path
  (`Tab`, `Ctrl+N`, `Ctrl+L`, `Ctrl+U`, `Ctrl+F`, `F1`, `Esc`, `Ctrl+Enter`).
- If the screen is left in a strange state after a crash, open a new terminal;
  the renderer should restore the terminal on a clean exit.

### `Ctrl+C` seems to do nothing

During a running turn, `Ctrl+C` cancels that turn. When idle, it quits. Press it
again after cancelling if the app does not exit immediately.

---

## Configuration

### "Invalid JSON in <path>"

The user config file is corrupted. Open it and fix the JSON, or move it aside to
start fresh:

```text
%APPDATA%\flux\config.json          (Windows)
~/.config/flux/config.json          (Linux/macOS)
```

Moving it aside removes provider profiles (environment credentials are
untouched). `FLUX_HOME` changes this location.

### "Invalid config: <field>: <message>"

Schema validation rejected the file. Common causes:

- `credentialRef` is not exactly `env:VARIABLE_NAME`.
- `baseURL` is not a valid URL.
- A budget is not a positive integer.
- `warnAtRatio` is outside `0.1`–`0.99`.
- A role name is not one of `main`, `explore`, `planner`, `implementer`,
  `reviewer`, `tester`.

Fix the reported field. FLUX never rewrites an invalid file silently.

### "Project .flux/config.json must not define providers or credentials."

A repository tried to define provider profiles. Remove `providers` from
`.flux/config.json`; provider profiles belong in your user config. Project files
may select model IDs, roles, fallback, budgets and UI settings only.

### A raw API key was rejected

FLUX accepts only credential *references*, for example `env:MY_GATEWAY_API_KEY`.
Put the secret in the environment and store only the reference. This is
intentional: config files are easier to leak than environment variables.

---

## Providers and models

### "No model configured. Run `flux auth` …"

No default model and no role override resolve for this session.

```sh
flux providers list
flux models use <provider> <model>
```

### "Unknown provider profile: <id>"

The model reference points at a profile that does not exist — often because a
project config or session was created on another machine. Check:

```sh
flux providers list
```

Either add the profile or select a model that exists.

### "Provider profile is disabled: <name>"

A reference resolves to a disabled profile. Re-enable it or choose another:

```sh
flux providers enable <id>
flux models use <other-provider> <model>
```

Do not disable the profile that currently provides your default model unless you
first select a different default; otherwise routing fails.

### "Environment variable <NAME> is not set…"

The credential reference is valid but the variable is missing in this process.

```powershell
$env:NAME = "…"                 # current PowerShell session
[Environment]::SetEnvironmentVariable("NAME", "…", "User")   # new terminals
```

```sh
export NAME="…"                 # POSIX
```

Check the exact name with `flux providers list` (it shows `env:NAME`). A shell
started before you set a persistent variable will not see it.

### `providers test` fails or hangs

`flux providers test <id>` sends one minimal streaming request with a probe tool
and a 180-second client timeout. Results are classified:

| Symptom | Category | Likely cause / fix |
|---|---|---|
| HTTP 401 / 403 | `provider-auth` | Wrong or missing credential; check the env var name and value. |
| HTTP 429 with "quota", "allowance", "balance", "exhaust" | `quota-exhausted` | Provider allowance is spent; wait for reset or use another provider. |
| HTTP 429 without those words | `rate-limit` | Too many requests; retry later or slow down. |
| HTTP 408 / 409 / 5xx | `transient` | Provider outage; retry or use another provider. |
| HTTP 404 | `unsupported-capability` | Wrong base URL/model, or the endpoint is not OpenAI-compatible. |
| Other HTTP status | `parse` | Inspect the endpoint and its request format. |
| Connection refused / fetch failed | `network` | Server not running, wrong host/port, firewall or TLS problem. |
| Timeout after ~180 s | `network`/`transient` | Endpoint hung or generated too slowly; try a smaller model or local server. |

For a local server, confirm it is running and that the base URL uses the
OpenAI-compatible path, typically ending in `/v1`:

```sh
curl http://127.0.0.1:11434/v1/models
```

Ollama: run `ollama serve` and pull the model first. LM Studio: start the local
server and enable the OpenAI-compatible API. LiteLLM/OmniRoute: use the gateway
base URL, not the upstream provider URL.

### `/models` fails but chat works

Some OpenAI-compatible servers do not implement `GET /models`. That is not fatal.
Add model IDs explicitly and pass one to the probe:

```sh
flux providers add --name Local --url http://host:port/v1 --model my-model
flux providers test local --model my-model
```

`flux providers models <id>` is the only command that needs `/models`.

### Capabilities show `unknown`

`unknown` means the probe did not observe the capability, not that it is missing.
The probe marks:

- `streaming` when it sees a text delta;
- `toolCalls` when it sees a tool-call event;
- `usageReporting` when it sees a usage event;
- `cancellation` as supported by the client.

A model that answers with plain text may never emit a tool call, so `toolCalls`
stays `unknown`. If it is explicitly marked `unsupported`, FLUX runs that target
without tools and says so. Choose a tool-capable model for coding work.

### Tool calls fail or the model loops

- Some models emit malformed JSON arguments; FLUX validates and returns a tool
  error instead of executing garbage.
- Some endpoints reject the `tools` field. Test with `flux providers test` and a
  tool-capable model.
- The step limit (default 12 for `main`, 6 for specialists) stops runaway loops.
  Raise it with `--max-steps` for a genuinely long task.

---

## Fallback

Fallback is intentionally conservative. It does **not** happen when:

- it is disabled in config (`flux models fallback on` is required);
- the applicable chain is empty;
- the primary and fallback are the same model (it is filtered out);
- the failure is `provider-auth`, `parse`, `unsupported-capability`,
  `budget-exhausted` or `cancelled`;
- the failure is not retryable;
- any text, reasoning or tool-call output was already accepted;
- the TUI session toggle is off (`Ctrl+F`).

A role-specific chain replaces the global chain for that role. If the role has a
chain, editing only the global chain has no effect on that role.

Check the effective configuration:

```sh
flux models fallback list
flux models role <role> clear        # fall back to the global chain
flux models fallback add <p> <m>
```

The TUI toggle only affects the current session; it cannot enable fallback when
the saved config has it disabled.

If fallback fires, the UI shows `from → to` and the classified reason. A
fallback is never silent and never moves to a provider you did not list.

---

## Budgets

### "budget-exhausted"

A configured session, task or agent limit was reached. The message names the
scope and the numbers. FLUX stops instead of switching providers.

- Start a new session, or
- Raise the limit in user config (`budgets`) and restart, or
- Remove the limit.

Note that when a provider does not report usage, FLUX estimates tokens with a
`char/4` heuristic. Budgets can therefore trigger earlier or later than exact
accounting would. `flux usage` labels the source.

### Usage looks too low/high

- `provider` means the endpoint reported it.
- `estimated` means the endpoint did not, so FLUX approximated.
- `mixed` means some requests in the group were reported and some were not.

FLUX does not infer quota, reset times or pricing. Nothing shown is a billing
statement.

---

## Permissions and tools

### "Permission denied: Session is in read-only mode…"

You launched with `--read-only` or configured `ui.permissionMode: "read-only"`.
Restart without it if edits are intended. A project `.flux/config.json` can also
set the mode through `ui`.

### "Permission denied: <destructive reason>…"

The command matched the always-denied list. It cannot be approved in-app. If you
really intend it, run it yourself outside FLUX. See
[safety.md](safety.md#3-always-denied-commands).

### "User rejected this action."

The model asked for a write or command and the approval was rejected (or no
approval handler was available). In headless mode, non-interactive runs deny by
default:

```sh
flux run "…" --yes              # explicit approval for this run
flux run "…" --accept-edits
```

In the TUI, approve/always/reject in the dialog and read the exact subject first.
"Always" trusts only that exact command for the session.

### "Path escapes the workspace" / "Path is outside the workspace"

File tools are confined to the workspace root. Use a relative path inside the
repository. If the real target is elsewhere, copy it in or run FLUX from the
correct root.

### "Path resolves outside the workspace via a link"

A symlink inside the repo points outside. FLUX refuses to follow it. Replace the
link with a real file/directory inside the workspace, or run from the target
location if that is intentional.

### "Refusing to read a credential-like file automatically"

The path matches the credential-file denylist (`.env`, SSH keys, `*.pem`, …).
FLUX will not open it automatically, even if the model asks. Share specific
non-secret content manually if it is genuinely needed.

### A command times out or output is truncated

- Default timeout is 120 s; the model can request up to 600 s.
- Output is bounded (about 60 KB per stream) and the result is flagged
  `output-truncated`.
- Run long jobs in smaller steps, write output to a file, or increase
  `timeoutMs` within the 600 s cap.
- The turn may be cancelled with `Ctrl+C`; the child process is aborted.

### PowerShell quoting behaves differently

On Windows, commands run in PowerShell:

```text
powershell.exe -NoLogo -NoProfile -NonInteractive -Command "<command>"
```

Use PowerShell syntax, not Bash. Stdin is not connected, so interactive prompts
will hang until the timeout. Pass non-interactive flags (`-y`, `--yes`, `-NoProfile`).

---

## Sessions and storage

### "Session not found: <id>"

The ID is wrong, the session was deleted, or you are using a different
`FLUX_HOME`/user profile.

```sh
flux sessions
flux sessions show <id>
flux resume <id>
```

### Sessions or providers are missing

Check `FLUX_HOME` and the platform default:

| OS | Default |
|---|---|
| Windows | `%APPDATA%\flux` |
| Linux/macOS | `${XDG_CONFIG_HOME:-~/.config}/flux` |

If you launched with `FLUX_HOME=...`, the same value must be set every time.
`flux doctor` prints the exact config and database paths.

### "database is locked"

Another FLUX process (or a tool holding the SQLite file) is using the database.
Close other FLUX instances and retry. Do not run multiple TUIs against the same
database concurrently.

### The database or config is corrupt

Back up the whole home directory first, then remove only the damaged file:

- `config.json` → loses provider profiles, keeps sessions.
- `flux.sqlite` → loses sessions, usage, approvals and verification evidence.

FLUX recreates the database schema on next start. There is no automatic repair
command in V1; copying the home directory aside is the safe reset.

### "Cannot remove the provider that is the current default model."

Select another default first:

```sh
flux models use <other-provider> <model>
flux providers remove <old-provider>
```

---

## Headless and JSON output

### `flux run` exits non-zero

A non-zero exit means the turn did not complete successfully, not necessarily
that the CLI crashed. Inspect the summary line or use `--json`:

```sh
flux run "…" --json
```

Look at `result.state`, `result.steps`, `budget.level`, and the event array. A
`failed` or `cancelled` state, a budget limit or a rejected approval can all
produce a non-zero exit.

### No text appears but tools ran

The model may be doing a tool-only turn, or the endpoint may not stream text.
Tool events are printed by `flux run`; the final summary still appears. With
`--json`, all events are captured.

### Non-interactive run denies everything

That is the default. Pass `--yes` (or `--accept-edits`) explicitly. Destructive
commands remain denied regardless.

---

## Resetting safely

1. Note the paths from `flux doctor`.
2. Copy the whole FLUX home directory to a backup location.
3. Remove only the file you intend to reset (`config.json` or `flux.sqlite`).
4. Run `flux doctor` again.

For an isolated experiment, use a throwaway home:

```powershell
$env:FLUX_HOME = "C:\Users\<you>\AppData\Local\Temp\flux-demo"
flux doctor
```

```sh
FLUX_HOME="$HOME/.cache/flux-demo" flux doctor
```

---

## Still stuck

Collect, without secrets:

- `flux --version` and OS/architecture
- `flux doctor --json`
- the exact command and the redacted error text
- whether the provider is local or hosted (never the key)
- the relevant session ID and `result.state`

Do not paste API keys, `.env` contents, Authorization headers or full process
environments into an issue or chat.
