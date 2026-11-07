# FLUX V1.1 porting decisions

## D-015 — Preserve FLUX's modular runtime

OpenCode and Crush are references, not replacement architectures. FLUX keeps
TypeScript + Bun, OpenTUI React, provider-independent routing, SQLite,
permissions, worktree support and ProofLoop evidence. OpenCode's Solid/client
and server graph, and Crush's Go runtime, are not compatible drop-in
dependencies.

## D-016 — No reference implementation code copied in the audit slice

The first parity slice is independently implemented. OpenCode source is MIT
licensed and may be adapted later with notices; Crush source remains study-only
because of FSL-1.1-MIT. `THIRD_PARTY_NOTICES.md` therefore needs no new copied
component entry for this slice.

## D-017 — Fix correctness before expanding UI

Fallback usage must be attributed to the model target that emitted the
successful response. Session resume must reconstruct durable messages and
verification state before adding more overlays. This prevents a polished UI
from reporting incorrect provider or evidence data.

## D-018 — Use native OpenTUI primitives, not a second renderer

Conversation Markdown, palette, session search and diff review will be built
with the existing OpenTUI React primitives. The implementation may use
bounded text rendering where a native renderer is unavailable, but it must
preserve streaming, width limits, focus and mouse behavior.

## D-019 — Search stays local and bounded

Session search is a SQLite title query scoped to the current FLUX database.
Repository search remains ignore-aware and workspace-bounded. No embeddings,
remote index or server is introduced for V1.1.

## D-020 — MCP/LSP remain deferred

MCP and LSP are valuable extensions, but adding them before a tested lifecycle,
permission model, cancellation contract and persistence story would weaken the
core safety guarantees. They are explicitly deferred rather than represented as
working UI.

## D-021 — Acceptance evidence is required

Automated tests cover pure logic and persistence. A real Windows Terminal pass
must still exercise launch, provider setup, streaming, mouse, keyboard,
resize, scrolling, approval, exit, resume, model switching, usage and
verification evidence. Headless checks must not be reported as that manual
pass.

## Implementation order

1. Correct fallback attribution and strengthen session query primitives.
2. Add a reusable FLUX rich-text renderer for headings, lists, fenced code and
   bounded wrapping.
3. Add searchable sessions and a command palette with keyboard/mouse actions.
4. Add changed-file and diff review state sourced from Git.
5. Add focused tests, then run the full automated suite and the Windows
   installation/TUI acceptance checklist.
