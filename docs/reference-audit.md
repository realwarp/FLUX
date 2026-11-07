# FLUX V1.1 reference audit

Date: 2026-11-07

This audit compares the working FLUX tree with the local OpenCode and Crush
trees. It records source locations and observed behavior, not assumptions based
on screenshots or README files.

## Licensing and reuse boundary

OpenCode is MIT licensed at `reference/opencode/LICENSE`. Compatible source may
be adapted when the applicable copyright and license notices are preserved.
This audit found no OpenCode source copied into FLUX. The OpenCode ideas listed
below are porting references only.

Crush is FSL-1.1-MIT licensed at `reference/crush/LICENSE`. Its implementation
is used only as behavioral and UX reference. No Crush implementation code is
copied or redistributed by FLUX.

## Existing FLUX baseline

| Area | Actual implementation | Evidence |
|---|---|---|
| Provider routing | OpenAI-compatible streaming adapter, profiles, role routing, opt-in fallback, usage and budgets | `packages/providers/src/*.ts`, `packages/agent-runtime/src/loop.ts` |
| Agent loop | Bounded tool loop, plan approval, bounded read-only delegation, tool-call persistence, verification events | `packages/agent-runtime/src/loop.ts` |
| Repository tools | Ignore-aware listing/search/read, workspace path checks, patch/write, PowerShell/host command execution, Git status/diff/log | `packages/repository/src/context.ts`, `packages/tools/src/registry.ts` |
| Permissions | Central read/write/shell policy with UI approval bridge and destructive-command denial | `packages/permissions/src/policy.ts`, `packages/tui/src/approvals.ts` |
| Persistence | SQLite sessions, messages, tasks, tool calls, approvals, verification and usage rows | `packages/persistence/src/database.ts` |
| TUI | OpenTUI React shell, multiline textarea, mouse approvals/session selection, responsive sidebar/inspector | `packages/tui/src/App.tsx` |
| Tests | Provider/fallback/budget, security/path, patch and persistence tests | `tests/*.test.ts` |

The baseline is functional, but the TUI is currently an event log: assistant
content is rendered as plain text, sessions are only truncated in a sidebar,
and there is no command palette or first-class diff view. The current inspector
counts edit events rather than reading the actual changed-file set.

## Reference implementation map

| Feature | OpenCode implementation | Crush reference | FLUX status and decision |
|---|---|---|---|
| Streaming agent loop | `reference/opencode/packages/core/src/session/runner/`, `src/session/run-coordinator.ts`, `src/session/store.ts` | `reference/crush/internal/agent/` | **ADAPT AND PORT**. Keep FLUX's in-process loop, SQLite contract and provider independence; adopt explicit step/state boundaries and recovery semantics. |
| Tool registry and patching | `reference/opencode/packages/core/src/tool.ts`, `src/tool/plugin/patch.ts`, `src/file-write.ts` | `reference/crush/internal/agent/tools/` | **REIMPLEMENT**. FLUX already has a smaller typed registry and different permission contract. Copying the OpenCode service architecture would violate the FLUX modular boundary. |
| Repository search/read | `reference/opencode/packages/core/src/filesystem.ts`, `src/filesystem/search.ts`, `src/tool/plugin/grep.ts`, `src/tool/plugin/glob.ts` | `reference/crush/internal/agent/tools/grep.go`, `glob.go`, `view.go` | **ADAPT AND PORT**. FLUX's ignore-aware `RepositoryContext` is compatible; add measured improvements only where tests expose a gap. |
| Permissions | `reference/opencode/packages/core/src/v1/config/permission.ts`, `src/session/permission.ts` | `reference/crush/internal/permission/` | **REIMPLEMENT**. FLUX must preserve its explicit approval handler, safe command policy and no-secret contract. |
| Session persistence/search | `reference/opencode/packages/core/src/session/store.ts`, `src/session.ts`, `packages/tui/src/component/dialog-session-list.tsx` | Crush session storage and picker under `internal/session` and `internal/ui` | **ADAPT AND PORT**. Add local SQLite title search and a TUI picker; do not introduce OpenCode's server/database stack. |
| Markdown and code rendering | `reference/opencode/packages/tui/src/plugin/markdown.ts`, `src/routes/session/message-parts.tsx`, `src/util/filetype.ts` | Crush markdown/message rendering under `internal/ui` | **REIMPLEMENT**. Use OpenTUI primitives and FLUX's React renderer; do not import Solid/OpenCode application code. |
| Multiline prompt | `reference/opencode/packages/tui/src/component/prompt/index.tsx`, `src/component/prompt/draft-stash.ts` | `reference/crush/internal/ui/textarea` and composer components | **ADAPT AND PORT**. FLUX already uses OpenTUI `textarea`; add draft/search/palette behavior without replacing the runtime. |
| Command palette | `reference/opencode/packages/tui/src/component/command-palette.tsx`, `src/context/keymap.ts` | Crush command/keybinding registry | **REIMPLEMENT**. A small FLUX command registry is sufficient and keeps all actions testable. |
| Diff review | `reference/opencode/packages/tui/src/component/patch-diff.tsx`, `src/feature-plugins/system/diff-viewer.tsx` | `reference/crush/internal/ui/diffview/` | **REIMPLEMENT**. Use `git diff --no-color` from FLUX's existing tool boundary and render bounded review output; no Crush code reuse. |
| Model/provider selection | `reference/opencode/packages/tui/src/component/dialog-model.tsx`, `dialog-config.tsx` | Crush provider/model selectors | **ADAPT AND PORT**. FLUX's provider registry and role router remain authoritative. |
| Themes/responsive layout | `reference/opencode/packages/tui/src/theme/`, `src/theme/system.ts`, `src/app.tsx` | Crush `internal/ui` theme/layout packages | **REIMPLEMENT**. Preserve FLUX colors and identity while adding semantic layout states. |
| MCP | `reference/opencode/packages/core/src/mcp/` and `packages/tui/src/component/dialog-mcp.tsx` | Crush MCP packages | **DEFER**. Requires a protocol client, lifecycle, permission surface and tests; no reliable V1.1 slice without expanding the safety boundary. |
| LSP | OpenCode language/client integrations and editor services | Crush language packages | **DEFER**. Not needed for repository coding workflows already covered by search/read/test tools. |
| Custom commands/hooks | OpenCode `src/plugin/command`, config/plugin hooks | Crush hooks under `docs/hooks` and `internal/hooks` | **REIMPLEMENT (limited)**. Project-local prompt commands are feasible; arbitrary hooks need a separate permission design. |

## Dependency observations

OpenCode's TUI uses Solid, its own client/schema packages, and a larger service
graph. Those dependencies cannot be introduced into FLUX without replacing the
requested TypeScript/Bun/OpenTUI modular architecture. Crush is Go/Bubble Tea
based and is not source-compatible with FLUX.

The compatible shared foundation is OpenTUI itself. The installed FLUX
dependency is `@opentui/core`/`@opentui/react` 0.8.3, with native Windows
notices already recorded in `THIRD_PARTY_NOTICES.md`.

## Acceptance gaps found

1. Plain text conversation rendering does not preserve Markdown structure or
   code blocks.
2. There is no searchable session picker.
3. There is no command palette.
4. The inspector does not show real changed-file/diff state.
5. Usage attribution after fallback currently needs to follow the target that
   actually emitted the response, not always the primary route.
6. Automated tests pass, but a live Windows Terminal mouse/resize/scroll/exit
   run remains required and cannot be claimed from headless checks.
