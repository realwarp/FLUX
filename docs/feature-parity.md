# FLUX V1.1 feature parity matrix

Status values describe end-to-end behavior, not whether a component exists.

| Feature | FLUX current status | Reference behavior | Classification | Acceptance test |
|---|---|---|---|---|
| Responsive terminal layout | Working baseline: sidebar/inspector collapse by width | OpenCode switches session panes and dialogs by available size | ADAPT AND PORT | Render at wide, narrow and very narrow sizes; composer remains usable |
| Conversation rendering | Streaming works; plain text only | OpenCode renders message parts, Markdown and code blocks | REIMPLEMENT | Send headings, lists and fenced code; verify structure survives streaming and resume |
| Syntax highlighting | Not implemented | OpenCode uses OpenTUI code/diff renderers and file type mapping | REIMPLEMENT | Render TypeScript and JSON fenced blocks without corrupting terminal width |
| Multiline composer | Working OpenTUI textarea; Ctrl+Enter submit | OpenCode adds drafts, autocomplete and keymap integration | ADAPT AND PORT | Enter inserts newline; Ctrl+Enter and mouse submit one prompt |
| Keyboard/mouse | Core shortcuts and approval/session clicks work | Both references make all core actions keyboard reachable | ADAPT AND PORT | Exercise approval, session switch, new session, cancel and exit by keyboard and mouse |
| Command palette | Missing | OpenCode `command-palette.tsx` filters registered commands | REIMPLEMENT | Ctrl+P opens palette; selecting an action performs the same command as its shortcut |
| Searchable sessions | Missing; sidebar truncates recent sessions | OpenCode session dialog searches title and scope | REIMPLEMENT | Search by title, select result, load persisted messages |
| Context overlays | Help and approval overlays work | OpenCode uses reusable dialogs for models, sessions, diff and config | ADAPT AND PORT | Overlay captures focus, closes with Esc/mouse and does not submit composer |
| Model/provider selector | CLI works; TUI displays route only | OpenCode has interactive model dialog | ADAPT AND PORT | Switch active model and role route without losing session |
| Theme system | Fixed FLUX palette | OpenCode has semantic/system/custom theme infrastructure | REIMPLEMENT | Theme choice changes all semantic surfaces and survives restart |
| Repository analysis | Ignore-aware files/search/read and manifest summary work | Both references build bounded repository context | DIRECT PORT | Ask a repository question; verify actual file/line evidence |
| File discovery/search | Working with ripgrep fallback | OpenCode and Crush expose bounded glob/grep tools | DIRECT PORT | Search a real repository with ignored/generated files present |
| Read files | Working with path and binary guards | Both references bound reads and reject unsafe paths | DIRECT PORT | Read line range, binary and outside-workspace paths |
| Edit files | write_file and unified apply_patch work with approval | OpenCode prepares diffs before permission and handles file mutation | ADAPT AND PORT | Approve a patch, inspect diff, verify file content |
| Apply patches | Working for additions/updates; deletion intentionally rejected | OpenCode supports add/update/delete/move | ADAPT AND PORT | Apply multi-hunk update and reject context mismatch safely |
| Shell commands | Working with timeout/output cap and approval | Both references show tool execution and result state | DIRECT PORT | Run pass/fail/timeout commands and persist evidence |
| Tool streaming/display | Tool calls/results stream into event log | OpenCode expands tool part state and output | ADAPT AND PORT | Observe call, result, failure and cancellation states |
| Plans and multi-step tasks | Plan approval and bounded steps work | OpenCode persists step/session state and resumes execution | ADAPT AND PORT | Reject and approve plan; verify no write occurs before approval |
| Tool failure recovery | Errors surface; loop continues for normal tool results | OpenCode preserves failure state and can continue/retry safely | ADAPT AND PORT | Tool validation failure is shown and next model step receives the error |
| Conversation context | SQLite history is sent on subsequent turns | OpenCode reloads durable context and manages compaction | ADAPT AND PORT | Resume and ask a follow-up that depends on prior tool output |
| Session resume | CLI/TUI resume loads messages | OpenCode has durable session store and suspended recovery | ADAPT AND PORT | Close, resume by ID, verify transcript and route |
| Git status | Working tool | Both references show repository state | DIRECT PORT | Dirty/clean status is visible and accurate |
| Changed-file explorer | Inspector only counts edit events | OpenCode has workspace file changes dialog/tree | REIMPLEMENT | Make two edits; list exact changed paths from Git |
| Diff viewer | Git diff tool exists; no dedicated TUI view | OpenCode and Crush render unified diffs | REIMPLEMENT | Open diff view, scroll, inspect additions/deletions and close |
| Patch review | Approval contains bounded patch text | OpenCode attaches prepared file diffs to permission | ADAPT AND PORT | Reject patch and verify no files changed |
| Test execution | `run_command` records verification | Both references expose command result lifecycle | DIRECT PORT | Run test command; verify exit code, duration and evidence row |
| Verification history | Rows persist; inspector shows latest only | OpenCode keeps durable timeline | ADAPT AND PORT | Resume session and inspect prior pass/fail results |
| MCP | Not implemented | OpenCode has MCP client/pool/config UI | DEFER | No acceptance test until permission/lifecycle design is approved |
| LSP | Not implemented | Reference integrations exist | DEFER | No acceptance test for V1.1 |
| Custom commands | CLI command surface is hard-coded | OpenCode loads command plugins/config | REIMPLEMENT (limited) | Project command file expands to a prompt without shell execution |
| Agent delegation | Main can delegate bounded read-only roles | OpenCode has subagents and lifecycle UI | DIRECT PORT | Delegate repository review and display start/state/result |
| Hooks | Not implemented | Crush/OpenCode expose hooks/plugins | DEFER | No acceptance test until execution policy exists |
| Project config | `.flux/config.json` project selection exists; provider secrets barred | OpenCode merges project config with user config | ADAPT AND PORT | Project model selection applies without accepting project credentials |
| Provider-specific capabilities | Probe records observed streaming/tools/usage | OpenCode normalizes provider capabilities | DIRECT PORT | Mock unsupported tool route; verify tools are withheld |

## Release gates

The next implementation slice is complete only when the corresponding tests
and manual Windows Terminal checks pass. A rendered control without a tested
action remains incomplete.
