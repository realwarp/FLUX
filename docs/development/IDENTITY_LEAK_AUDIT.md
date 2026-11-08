# FLUX identity-leak audit

Audit performed before implementation of the identity correction. Reference repositories and third-party licence notices were not modified.

## Confirmed user-facing leaks

| Surface | Finding | Origin and effect |
|---|---|---|
| Model system prompt | The default preamble says, “You are a coding assistant running inside pi, a coding agent harness.” It also includes Pi-specific documentation instructions, absolute `node_modules` documentation paths, and says “Additional tools may be available.” | `createAgentSession()` in `src/cli.ts` supplied no resource loader or prompt override, so the SDK's default prompt builder became the active prompt. That builder also auto-discovers Pi system/append prompt files and context instructions. |
| Workspace context | The SDK adds its `cwd` section after the prompt and replaces Windows backslashes with forward slashes. | The prompt builder applies `cwd.replace(/\\/g, "/")`. That does not preserve native Windows formatting. It would produce a drive-qualified `C:/...` value on Windows; the observed `/users/ashwi/...` value is not a literal configured value and appears to be the model's unsupported reinterpretation, enabled by the missing FLUX identity/context rules. |
| Extra prompt sources | User/project `SYSTEM.md`, `APPEND_SYSTEM.md`, and context files can affect the active prompt. | The SDK's default resource loader discovers these automatically. They can override or contradict FLUX identity and runtime instructions. |
| Session evidence text | The persistence store records “Pi session completed the prompt.” | `src/cli.ts` and `src/ui/pi-app.ts` append this string after a turn. It is not sent as an agent message, but it leaks the dependency name in FLUX-owned session records. |
| Package description | Package metadata describes the product as “A Pi-based terminal coding agent.” | `package.json` description is visible through package-manager metadata and distribution tooling. |
| Session status | Status surfaces exposed the SDK-managed session file and full UUID. The default file path contains `.pi\agent\sessions`. | `src/cli.ts`, `src/ui/index.ts`, and `src/ui/pi-app.ts` rendered `sessionFile` directly. This exposed an internal implementation path and presented a raw session UUID as the label. |

## Verified non-leaks / provenance boundaries

- FLUX constructs its own `read`, `search`, `write`, `patch`, and `shell` tools in `src/tools/pi-tools.ts`. Mutation and shell descriptions specify approval; `ApprovalPolicy` remains the execution gate.
- `noTools: "builtin"` suppresses SDK built-in tools; it does not suppress FLUX custom tools.
- FLUX resolves the launch workspace in `src/cli.ts`, passes it to `createWorkspace`, `SessionManager`, and each `AgentSession`, and scopes session listing/restoration to that workspace. The incorrect POSIX-looking path is not sourced from the configured workspace string.
- Provider routing, imports, code comments, architecture/reference documents, and licence notices name Pi only to describe the actual implementation dependency. These are technical provenance, not product-facing identity, and must remain truthful.
- Other audited user-visible labels, help text, selectors, approvals, and non-TTY output identify the application as FLUX.

## Root cause and corrective direction

The identity leak is caused by inheriting the SDK's default system prompt, not by the FLUX provider router. The default prompt explicitly identifies Pi, includes Pi-runtime documentation guidance, allows for undeclared extra tools, and inserts a slash-normalized working directory. FLUX had no centralized prompt, no authoritative native-path context, and no regression test inspecting the provider-bound message sequence. The model's unsolicited capability advertisement and `/users/...` path are not literal FLUX strings; they are unsupported model output made more likely by that inherited, ambiguous context.

Pre-change runtime inspection created an `AgentSession` with FLUX's actual model registry and custom tools. Its effective prompt contained the Pi preamble, Pi documentation instructions, absolute paths into `node_modules`, and a slash-normalized configured workspace. Its transcript had no messages before the first prompt; Pi constructs the system/tool messages when starting the provider request. The observed POSIX-looking path was not a literal configured value.

The correction must replace the inherited prompt construction at the provider-request boundary for every FLUX session, omit untrusted prompt overrides, provide the exact configured workspace in native format, and describe only FLUX-registered tools and their approval behavior. Session restoration, new sessions, and model changes must continue to use the same FLUX-owned prompt/context contract. Dependency names and licences remain documented accurately outside normal assistant conversation.

## Correction implemented

- `src/agent/system-prompt.ts` now owns FLUX identity, interaction behavior, native workspace/platform context, and the actual per-run approval mode. It is installed through each new/restored session's `ResourceLoader` and a hidden `before_agent_start` hook, so model switches and provider requests retain one authoritative prompt.
- Pi default extension, skill, prompt-template, theme, and context-file discovery is disabled for FLUX sessions. The hook replaces the provider-bound system message rather than appending a competing prompt.
- The runtime prompt lists only FLUX's registered `read`, `search`, `write`, `patch`, and `shell` tools, states their real permission boundaries, requires truthful tool-result reporting, and permits accurate dependency provenance only when directly asked.
- FLUX-owned completion records and package metadata use FLUX branding. Error presentation hides dependency installation paths, SDK session-storage paths, and internal Pi package identifiers while preserving a clear failure.
- Status and welcome output show a short session identifier plus persistence state, never the SDK's session-file path or a full UUID.
- `tests/integration/identity.test.ts` exercises a captured OpenAI-compatible provider request, exact native Windows workspace context, one FLUX system message and tool list, saved-session restoration, workspace isolation, real read results, denied writes, malformed arguments, and inaccessible paths.
- Live Windows verification with installed `qwen35-9b-20k:latest` confirmed short FLUX identity answers and the exact configured workspace. Tool invocation was observed for `read`; a denied write left no file. See `TASKS.md` for current automated results and remaining manual acceptance.

## Release-candidate runtime context

The provider-bound FLUX prompt now also identifies the terminal TUI/CLI surface and the active provider/model. These values are refreshed from the active session before each agent start, including after a model switch. Inference wording is deliberately limited to verified endpoint facts: a loopback Ollama endpoint and installed-model listing do not prove that inference is never forwarded elsewhere. The exact workspace and host OS remain application-supplied values.

Startup now checks installed Ollama models and presents an actionable pull/select instruction rather than silently choosing a different model. If the configured provider has no usable registered model, FLUX stops with an actionable error instead of allowing the SDK to select an unrelated global default. Session switching verifies that a selected file still exists and is readable, and sessions without a verified matching workspace are excluded from workspace lists.
