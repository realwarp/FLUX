# FLUX Reference Component Map

## Pi — technical foundation

**Repository:** `reference/pi`  
**Language:** TypeScript/ESM  
**License:** MIT (`reference/pi/LICENSE`)

| Source | Actual components | FLUX decision | Destination |
|---|---|---|---|
| `reference/pi/packages/tui/src/tui.ts` | `Component`, `Container`, `TUI`, `Focusable`, normalized mouse events, focus and overlay contracts | Reuse the public APIs directly; do not build a second terminal framework. | `src/ui/pi-app.ts`, `src/ui/overlays.ts` |
| `reference/pi/packages/tui/src/tui-alt-screen.ts` | `TuiAltScreen`, differential rendering, owned viewport, mouse selection, search, scroll-to-end | Use as FLUX's default fullscreen renderer. | `src/ui/pi-app.ts` |
| `reference/pi/packages/tui/src/tui-main-screen.ts` | `TuiMainScreen`, terminal-owned scrollback | Use as a fallback mode. | `src/ui/pi-app.ts` |
| `reference/pi/packages/tui/src/components/editor.ts` | `Editor`, multiline editing, history, autocomplete, paste handling, IME cursor support | Reuse directly for the composer. | `src/ui/composer.ts` |
| `reference/pi/packages/tui/src/components/markdown.ts` | `Markdown`, syntax/code rendering, invalidation | Reuse directly for transcript messages. | `src/ui/transcript.ts` |
| `reference/pi/packages/tui/src/components/scroll-view.ts` | `ScrollView`, follow-end, scrollbars, overscroll | Reuse for transcript/sidebar scrolling. | `src/ui/transcript.ts`, `src/ui/sidebar.ts` |
| `reference/pi/packages/tui/src/components/v-stack.ts`, `h-stack.ts`, `box.ts`, `text.ts`, `truncated-text.ts` | Width-aware layout and basic components | Reuse for responsive layout and status surfaces. | `src/ui/layout.ts`, `src/ui/header.ts`, `src/ui/footer.ts` |
| `reference/pi/packages/tui/src/components/select-list.ts`, `settings-list.ts` | Searchable keyboard/mouse selection | Reuse for palette, model, and session overlays. | `src/ui/overlays.ts` |
| `reference/pi/packages/tui/src/keys.ts`, `keybindings.ts` | `matchesKey`, parsed key events, configurable bindings | Reuse; application shortcuts remain configurable. | `src/ui/keybindings.ts` |
| `reference/pi/packages/tui/src/colors.ts`, `utils.ts` | Semantic colors, visible-width wrapping/truncation | Reuse utilities with FLUX tokens. | `src/ui/theme.ts`, `src/ui/*` |
| `reference/pi/packages/coding-agent/src/core/sdk.ts` | `createAgentSession`, `SessionManager`, Pi coding tools and events | Keep as the agent/session backend. | `src/cli.ts`, `src/ui/controller.ts` |

## OpenCode — capability and workflow reference

**Repository:** `reference/opencode`  
**Language:** TypeScript/TSX, SolidJS  
**License:** MIT (`reference/opencode/LICENSE`)

| Source | Actual components/workflows | FLUX decision | Destination |
|---|---|---|---|
| `reference/opencode/packages/app/src/shell/commands/dialog.tsx` | `DialogCommandPalette`, `CommandPaletteView`, grouped async search and selection | Adapt the workflow to Pi `SelectList`/`SettingsList`; do not import Solid/browser UI. | `src/ui/palette.ts`, `src/ui/overlays.ts` |
| `reference/opencode/packages/app/src/shell/commands/palette.ts` | `CommandPaletteEntry`, deduplication, command/file/session selection | Adapt the typed entry model and async-source lifecycle. | `src/ui/palette.ts` |
| `reference/opencode/packages/app/src/providers/models/select-dialog.tsx` | Provider grouping, model search, active selection and model switching | Adapt provider grouping and selection to Pi components and `AgentSession.setModel`. | `src/ui/overlays.ts` |
| `reference/opencode/packages/app/src/session/requests/session-permission-dock.tsx` | `SessionPermissionDock`, explicit once/always/reject decisions and full argument display | Adapt the decision model and disclosure rules to a Pi overlay. | `src/ui/permission-overlay.ts` |
| `reference/opencode/packages/app/src/session/timeline/controller.tsx` | Timeline projection, compact/expanded tool detail, reasoning visibility, turn diff integration | Adapt event projection to Pi `AgentSessionEvent` and FLUX evidence records. | `src/ui/transcript.ts`, `src/ui/tool-cards.ts` |
| `reference/opencode/packages/core/src/permission.ts` | Permission evaluation and decision lifecycle | Reuse behavior concepts; retain FLUX `ApprovalPolicy` implementation. | `src/safety/approval.ts`, `src/ui/permission-overlay.ts` |
| `reference/opencode/packages/core/src/session/diff.ts` | Turn-level diff workflow | Adapt to Pi sessions and bounded local `git diff`. | `src/ui/diff-overlay.ts` |

OpenCode's server, Effect, protocol, database, and browser runtime are not FLUX dependencies and no OpenCode source is copied into the current implementation.

## Crush — interaction and visual reference

**Repository:** `reference/crush`  
**Language:** Go, Bubble Tea v2, Lip Gloss v2, Ultraviolet  
**License:** FSL-1.1-MIT (`reference/crush/LICENSE.md`, Charmbracelet copyright)

| Source | Actual components/workflows | FLUX decision | Destination |
|---|---|---|---|
| `reference/crush/internal/ui/model/ui.go` | `UI.generateLayout`, `uiLayout`, wide/compact layout, fixed sidebar, editor/footer regions | Port the geometry and responsive information hierarchy to Pi stacks. | `src/ui/layout.ts` |
| `reference/crush/internal/ui/model/header.go` | `header`, `drawHeader`, `renderHeaderDetails` | Port compact project/branch/model/context/activity status behavior. | `src/ui/header.ts` |
| `reference/crush/internal/ui/model/sidebar.go` | `modelInfo`, sidebar scroll state, changed-file/service sections | Port information architecture and virtual scrolling using Pi `ScrollView`. | `src/ui/sidebar.ts` |
| `reference/crush/internal/ui/chat/tools.go` | `ToolMessageItem`, `ToolRenderer`, `NewToolMessageItem`, pending/success/error/canceled states | Port the renderer contract and collapsed/expanded behavior; implement in TypeScript. | `src/ui/tool-cards.ts` |
| `reference/crush/internal/ui/chat/bash.go`, `file.go`, `search.go`, `fetch.go`, `agent.go`, `generic.go` | Tool-specific renderers for shell, files, search, fetch, agents, fallback | Port presentation rules only; map to Pi tool events. | `src/ui/tool-cards.ts` |
| `reference/crush/internal/ui/styles/styles.go`, `quickstyle.go`, `themes.go` | Semantic style groups, diff/status tokens, theme composition | Use as visual input only; create a distinct FLUX palette and branding. | `src/ui/theme.ts` |
| `reference/crush/internal/ui/model/keys.go` | Explicit editor/chat/global focus, scrolling, details and sidebar bindings | Adapt the interaction matrix to Pi `KeybindingsManager`. | `src/ui/keybindings.ts` |

No Crush implementation code is currently reused. FSL permits copying only for a Permitted Purpose and requires preserving notices; commercial products competing with Crush remain restricted until the future MIT grant or separate clearance. FLUX will not use Crush's name, logo, trademarks, or Charmtone identity.

## Integration boundary

Pi supplies the runtime TUI and agent primitives. OpenCode supplies capability/workflow semantics. Crush supplies audited layout, tool-card, and interaction patterns. FLUX owns the controller, approval boundary, evidence persistence, palette contents, branding, theme tokens, and final TypeScript components.
