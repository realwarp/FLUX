# FLUX Agent Handoff

## Current architecture

The repository is a clean-room build. Pi is the proposed runtime foundation because its `pi-ai`, `pi-agent-core`, `pi-coding-agent`, and `pi-tui` packages align with the required conversation-first coding-agent loop and modular terminal architecture. This choice remains pending source-level validation against the three references.

## Active agents

The Pi, safety, provider/persistence, and terminal UI specialists completed their assigned isolated file areas. The lead integrated and reviewed their outputs; no implementation agent remains active.

## Task ownership

See `TASKS.md`; each task has an exclusive file area and explicit dependencies.

## Files being modified

The product lives under `src/` with focused tests under `tests/`. Reference repositories under `reference/` remain read-only.

## Completed work

- Read `PROJECT_ZERO.md` completely.
- Created the authoritative taskboard before implementation.
- Confirmed the repository contains no legacy product source to restore.
- Validated Pi 1.5.0 as the foundation and recorded OpenCode/Crush component and license boundaries.
- Implemented the Pi-backed CLI, safe workspace primitives, provider routing, local session evidence, and terminal presentation.
- Completed the disposable real-model coding workflow and Windows global-install smoke test.

## Blockers

No release-scope blockers remain. Cloud providers still require operator-supplied credentials; local Ollama was used for the verified live demonstration.

## Integration decisions

- Do not restore legacy/v1.1.
- Do not make the references runtime dependencies.
- Prefer adapting compatible Pi packages over reimplementing equivalent agent primitives.
- Port OpenCode behavior selectively and use Crush only as a visual/reference source unless licensing permits otherwise.

## Last verified build

`bun run check`, `bun run build`, and the focused 5-test suite pass. `bun add -g .` installed `flux`, and the installed executable resumed the disposable session against the live Ollama model.
