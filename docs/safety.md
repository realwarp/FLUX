# Safety and permissions

FLUX can read files, write files, apply patches and run shell commands. This
page describes the guardrails, what they do and do not guarantee, and how to
grant access deliberately.

> **Core rule:** the model is not trusted, repository content is not trusted, and
> only you approve changes. FLUX reduces accidental damage. It is not a
> sandbox, a VM or a security boundary against a hostile local process.

---

## 1. Trust model

| Component | Trust level | Consequence |
|---|---|---|
| You | Authority | You decide approvals, permission mode and which provider receives code. |
| FLUX policy engine | Trusted code | Evaluates every tool call before execution. |
| The model | Untrusted | May be wrong, may be manipulated by repository text, may propose dangerous commands. |
| Repository content | Untrusted | Source, docs, issues and tool output can contain prompt injection. |
| Provider endpoint | External | Receives the prompts, file contents and tool output you allow it to see. |
| Shell commands | Unrestricted by FLUX | Run with your OS user's privileges. |

Before you connect a hosted provider, assume that files read by FLUX, prompts,
and tool output may leave your machine. Use a local endpoint if the content must
not leave the machine.

---

## 2. Permission modes

The default is `ask`.

| Mode | Reads | Writes / patches | Shell commands | Git writes |
|---|---|---|---|---|
| `read-only` | allowed | **denied** | **denied** | **denied** |
| `ask` (default) | allowed | approval required | approval required | approval required |
| `accept-edits` | allowed | allowed | allowed | allowed |

Set the persistent default in user config:

```json
{
  "ui": { "permissionMode": "ask" }
}
```

Set it per launch:

```sh
flux --read-only                 # TUI, deny all writes/commands
flux --accept-edits              # TUI, approve non-destructive actions
flux run "…" --read-only
flux run "…" --yes               # approve writes/commands for this run
flux run "…" --accept-edits
```

`--yes` and `--accept-edits` are explicit opt-ins. Without them, a
non-interactive `flux run` denies every action that would need approval.

### What "accept-edits" does not do

It does **not** disable the destructive-command denylist. `git reset --hard`,
force-push, broad recursive deletes and similar commands remain denied in every
mode, including `accept-edits` and `--yes`.

### Approval decisions

When a tool needs approval, FLUX shows the exact tool, path, command or patch.

| Decision | Effect |
|---|---|
| **Approve** | Allow this one action. |
| **Always** | Allow this *exact* shell command for the rest of the session. It does not trust other commands, other paths or future sessions. |
| **Reject** | Do not run it. The model receives "user rejected this action" and must adapt. |

Plans use a separate approval dialog. Approving a plan authorizes the steps in
the plan; it does not pre-approve every future tool call. Writes and commands
still follow the active permission mode.

---

## 3. Always-denied commands

These patterns are checked before the permission mode, so they cannot be
approved interactively:

| Pattern | Reason |
|---|---|
| `git reset --hard` | discards working-tree changes |
| `git clean -f…` | deletes untracked files |
| `git push … --force` / `git push … -f` | rewrites remote history |
| `rm -rf /`, `rm -rf *`, `rm -rf ~`, `rm -rf $HOME`, `rm -rf <drive>:\` | broad recursive delete |
| `del /s|/f|/q … *.*` | broad recursive delete |
| `format <drive>:` | disk format |
| `mkfs…` | filesystem creation destroys data |
| `shutdown`, `reboot` | system power control |
| `Remove-Item … -Recurse … -Force` | broad recursive delete |

This is a best-effort regex denylist, not a complete command parser. Shell
indirection, aliases, scripts, encoded commands and multi-line constructs can
evade pattern matching. Treat approvals as the real control: read the exact
command before approving it.

The TUI and CLI show the actual command text. If it is not what you expect,
reject it.

---

## 4. Workspace boundary

File tools resolve every path against the workspace root (the nearest directory
containing `.git`, or the launch directory when there is no Git repository).

- `..` and absolute paths that escape the root are rejected.
- Existing symlinks are resolved and the **real** target must remain inside the
  workspace. A link pointing outside is rejected.
- Writes create parent directories only inside the workspace.
- Shell commands use the workspace root as their working directory (or a
  workspace-relative `cwd` that must exist).

Path resolution is enforced in the tool layer, not merely requested in the
prompt.

### Credential-like files

FLUX refuses to read or write credential-looking paths automatically:

- `.env`, `.env.*`
- `.npmrc`, `.netrc`
- `id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519`
- `*.pem`, `*.key`, `*.pfx`, `*.p12`, `*.jks`, `*.keystore`
- `credentials.*`, `secret.*`, `secrets.*` (JSON/YAML/TOML/INI)
- `.aws/credentials`, anything under `.ssh/`

These are denied at the path layer even if the model asks for them. This is a
guardrail against accidental exfiltration, not a data-loss-prevention product:
a secret stored in a normally named file can still be read.

Repository context also excludes common build output, dependencies, binary
media, databases and lockfiles. `.gitignore` and `.fluxignore` are honored.

---

## 5. Credentials

- A provider credential is stored only as `env:VARIABLE_NAME`.
- The variable is read from the process environment at request time.
- Raw keys in config are rejected by schema validation.
- `flux providers list`, `doctor`, session data and TUI labels show the
  reference, never the value.
- Error messages and event text run through redaction for bearer tokens, common
  API-key shapes and `api_key=…`/`token=…` assignments.
- FLUX does not import credentials from OpenCode, Claude Code, OmniRoute, Git or
  the OS credential store.
- There is no credential-store adapter in V1. Environment variables are the only
  supported mechanism.

Environment variables are visible to other processes running as your user. Use a
dedicated variable per provider and rotate keys as you would for any CLI tool.

Provider profiles support custom `headers` in config; a header value beginning
with `env:` is resolved the same way. Literal header values are stored in
plaintext, so do not put secrets there.

---

## 6. Shell execution

On Windows, commands run through:

```text
powershell.exe -NoLogo -NoProfile -NonInteractive -Command "<command>"
```

On other platforms:

```text
/bin/sh -lc "<command>"
```

Properties:

- stdin is not connected, so interactive prompts cannot be answered.
- `NO_COLOR=1` and `CI=1` are added to the environment.
- Default timeout: **120 seconds**. The tool may request up to **600 seconds**.
- Captured output is bounded (about 60 KB per stream); over-limit output sets a
  `truncated` flag. Tool content shown to the model is capped separately.
- The result records exit code, duration, timeout and truncation.
- Cancelling the turn aborts the child process.

FLUX does not restrict network access, environment variables, child processes or
filesystem access outside the working directory. A command that succeeds is not
proof that it was safe.

---

## 7. Tool-call integrity

- Each tool call is written to SQLite as started **before** it is dispatched.
- On finish, the result is recorded. A call marked executed is not re-run.
- Within a run, duplicate call IDs are suppressed.
- Provider fallback happens only before any text, reasoning or tool-call event
  is accepted. An accepted stream is never replayed, so fallback cannot cause a
  tool to execute twice.
- If FLUX crashes mid-call, the call remains recorded as started; inspect the
  session rather than assuming it completed.

---

## 8. Subagent bounds

Specialist roles are restricted by a fixed tool allowlist:

| Role | Allowed |
|---|---|
| `main` | all tools, plus `delegate_task` |
| `explore`, `planner`, `reviewer` | read/list/search/git-read/`propose_plan` |
| `tester` | read/list/search/git-read/`propose_plan` + `run_command` |
| `implementer` | all tools except `delegate_task` |

Additional limits:

- Delegation is one level deep. A subagent that tries to delegate again is
  rejected.
- Subagents default to 6 loop steps; `main` defaults to 12. `--max-steps`
  overrides the main loop.
- Subagents share the session approval handler and permission mode.
- `delegate_task` accepts only `explore`, `planner`, `reviewer` and `tester`.
- Conversation history is trimmed to a character budget before each request.

Read-only roles cannot write files even if the model asks to. The tool list is
filtered before it is sent to the provider.

---

## 9. Verification evidence

Every `run_command` result is persisted as verification evidence:

- exact command and working directory
- exit code and duration
- bounded output and truncation flag
- `passed` only when exit code is 0 and the command did not time out
- `failed` otherwise

The TUI inspector shows the latest result. Evidence is a record of what actually
ran, not proof that the change is correct. A passing test can be the wrong test;
a failing test can be unrelated. Read the command and output.

FLUX is instructed never to claim a command passed unless it ran, but that is a
prompt-level instruction. The persisted evidence is the authoritative record.

---

## 10. What FLUX does not protect against

- A malicious model or prompt injection causing you to approve a harmful command
  you did not read carefully.
- Secrets stored in otherwise harmless files.
- Commands that evade the denylist through scripts, aliases or encoding.
- Data sent to a hosted provider you configured.
- Risk from dependencies installed or scripts run by approved commands.
- OS-level privilege escalation or a compromised local machine.
- Losing uncommitted work: FLUX can write files and run commands that modify the
  working tree. Commit or stash important work first.

Use a disposable checkout or container for untrusted repositories, review every
approval, and keep backups.

---

## 11. Reporting a problem

Do not include API keys, tokens, `.env` contents or full environment dumps in a
report. Redact the command and output to the minimum needed to reproduce the
issue, and state the FLUX version (`flux --version`), OS and provider protocol
(not the credential).
