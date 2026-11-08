# FLUX TUI Architecture Proposal

## Foundation

Use `@earendil-works/pi-tui` 1.5.0 as the only terminal framework:

- `TuiAltScreen` by default for differential rendering, resize handling, owned scrolling, mouse selection, search, and overlays.
- `TuiMainScreen` as a scrollback-preserving fallback.
- Pi `Editor`, `Markdown`, `ScrollView`, `VStack`, `HStack`, `Box`, `SelectList`, `SettingsList`, `MouseRegion`, `matchesKey`, and `KeybindingsManager` directly.

The current text renderer remains an interim compatibility surface until the Pi TUI controller is implemented; it is not the target architecture.

## Component graph

```text
src/cli.ts
  -> src/ui/controller.ts       Pi AgentSessionEvent -> retained UI state
  -> src/ui/pi-app.ts           TuiAltScreen/TuiMainScreen lifecycle
     -> src/ui/layout.ts        wide/narrow responsive composition
        -> header.ts
        -> transcript.ts        ScrollView + Markdown
        -> sidebar.ts            model/context/files/activity
        -> composer.ts           Pi Editor
        -> footer.ts
     -> tool-cards.ts            pending/running/success/error/canceled cards
     -> overlays.ts              palette/model/session selectors
     -> permission-overlay.ts    once/always/deny approval flow
     -> diff-overlay.ts          bounded git diff and turn changes
     -> theme.ts, keybindings.ts FLUX identity and configurable controls
```

## Layout

Wide terminals use a Crush-inspired information hierarchy implemented with Pi components:

```text
header: project · branch · model · context · activity
main:   transcript                    sidebar
        transcript                    model/files/status
composer: multiline Pi Editor
footer:  shortcuts · approval state · verification state
```

Narrow terminals collapse the sidebar and use `VStack(header, transcript, composer, footer)`. `ScrollView` follows the transcript end until the user scrolls away; resize recomputes layout without changing message state.

## Workflows

- **Conversation:** Pi `AgentSessionEvent` drives streaming Markdown and retained message state.
- **Tools:** each `tool_execution_start/update/end` maps to a typed card with capped output, expansion, and semantic status. Crush's per-tool presentation rules are reimplemented in TypeScript, not copied from Go.
- **Command palette:** OpenCode's grouped, searchable, asynchronous `CommandPaletteEntry` workflow maps to Pi selection components. Entries include commands, sessions, files, and models.
- **Model selector:** provider-grouped model rows call `session.setModel` and update header/sidebar state.
- **Permissions:** OpenCode's once/always/reject vocabulary maps to a Pi overlay backed by `ApprovalPolicy`; validated arguments and resource patterns are fully scrollable before approval.
- **Diff/recovery:** OpenCode's turn-diff concept maps to Pi session events plus bounded local `git diff`; `SessionManager.continueRecent` restores prior context.
- **Keyboard/mouse:** Pi owns parsing, focus, IME, mouse dispatch, and configurable bindings. Every mouse action has a keyboard equivalent.

## FLUX identity

FLUX uses a distinct semantic palette: deep ink background, electric cyan accent, warm amber approval state, blue-white assistant text, and coral destructive/diff deletion state. It uses a compact `F/`-based FLUX wordmark, not Crush branding. Layout spacing follows Pi's measured components; hierarchy follows the audited Crush structure; capability surfaces follow OpenCode's workflows.

## License boundary

Pi and OpenCode code used through published dependencies or permitted adaptation remain MIT-licensed with attribution. Crush source is FSL-1.1-MIT. No Crush source is copied in this phase. Any future direct reuse must preserve `reference/crush/LICENSE.md`, copyright notices, and this map, and must be cleared for the intended commercial use before release.

## Implementation and verification gate

Do not mark the TUI complete on source presence. The implementation must pass type-check/build and a Windows Terminal run against real Ollama covering multiline Editor input, streaming Markdown, read/search, approved write/shell, once/deny approval paths, tool cards, resize, transcript scroll/follow, palette search, model switching, diff display, and session resume. Actual results belong in `TASKS.md`.
