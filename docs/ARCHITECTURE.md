# FLUX Architecture

## Foundation decision

Pi is the proposed and validated foundation. Its MIT-licensed packages expose the exact layers FLUX needs: `@earendil-works/pi-ai` for provider/model streaming, `@earendil-works/pi-agent-core` for the agent loop, `@earendil-works/pi-coding-agent` for sessions and coding tools, and `@earendil-works/pi-tui` for terminal rendering. The packages are published at version 1.5.0, use Node 22.19 or newer, and document native Windows support.

This is preferable to rebuilding equivalent runtime behavior because Pi already provides tool definitions, model restoration, session management, streaming events, and Windows shell handling. FLUX owns the product boundary around it: configuration, approval policy, workspace containment, verification records, and the terminal experience. OpenCode and Crush are references for selective behavior and presentation, not runtime dependencies.

## Runtime shape

```text
flux CLI
  -> config/provider selection
  -> Pi AgentSession + Pi SessionManager
  -> FLUX approval and workspace policy
  -> Pi coding tools (read/search/write/edit/shell)
  -> persisted session and verification evidence
```

The CLI is intentionally conversation-first. It runs from the selected workspace, streams model events, exposes explicit commands for session status and verification, and keeps mutation tools behind the FLUX approval policy.

## Compatibility constraints

- Runtime dependencies are published packages; the reference repositories are build-time inputs only.
- Node 22.19+ and Bun 1.4+ are supported for development; the generated CLI is installed with `bun add -g .`.
- Native TUI features are optional at the first release boundary so a Windows installation does not require compiling unrelated native code.
- No legacy/v1.1 source or databases are read or migrated.
