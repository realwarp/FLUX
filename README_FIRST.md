# FLUX V1 Agent Build Kit — Start Here

This folder contains the build brief and prompts for running the FLUX V1 team in Herdr.

## Files

- `spec.md` — product requirements and V1 acceptance criteria.
- `architecture.md` — system design, runtime choices, components, safety model, and development-team topology.
- `implementation_plan.md` — phases, order of work, quality gates, and collaboration protocol.
- `opencode_prompt.md` — paste into the main OpenCode session.
- `claudecode_prompt.md` — paste into the primary Claude Code collaborator session.
- `agent_handoff.md` — the one shared file both primary agents use for durable coordination.

The V1 contract includes multiple OpenAI-compatible provider profiles (hosted and local), per-agent model overrides, user-configured fallback, usage tracking, and task/session/agent budgets. FLUX must never silently move work to a paid provider or infer external quota/reset limits.

## Suggested Windows setup

1. Create your FLUX project folder, for example `C:\Users\<you>\workplace\flux`.
2. Copy all Markdown files into that folder's root. Keep `agent_handoff.md` at the root.
3. Open Herdr in that folder and make sure `herdr`, `opencode`, `claude`, `bun`, and `git` are available.
4. Install the Herdr integrations if they are not already installed:

   ```powershell
   herdr integration install opencode
   herdr integration install claude
   ```

5. Open one pane for OpenCode and one for Claude Code. Start the sessions using the model configurations already in place:
   - OpenCode: existing BharatCode model.
   - Claude Code: existing local OmniRoute model.
6. Paste the full contents of `opencode_prompt.md` into OpenCode. Paste the full contents of `claudecode_prompt.md` into Claude Code.
7. OpenCode should not repeatedly retry BharatCode while the daily student allowance is exhausted. It can delegate audits, compatibility checks, design, mocks, tests, and other local work to Claude Code until quota is available again.
7. Let OpenCode act first as lead. Claude should complete the initial independent review, write its response in the `Claude Code → OpenCode` section of `agent_handoff.md`, and then wait for a scoped assignment.

## Herdr coordination note

Herdr's agent automation requires an existing shell pane before `herdr agent start`. OpenCode must inspect the installed Herdr CLI help, create or identify a pane, capture its actual returned pane ID, and then launch Claude Code. It should use Herdr's agent prompt/wait/read commands when available. Do not guess pane IDs or automate prompts by blindly sending keystrokes.

## Important safety notes

- Do not paste or store API keys in these Markdown files.
- Do not let both agents edit the same files concurrently.
- Do not let a subagent merge or overwrite the lead's work.
- Do not change global OpenCode, Claude Code, or OmniRoute configuration.
- Inspect the existing folder and Git state before creating files; never delete pre-existing work.
- Do not publish the package until the package name/scope and license have been verified.

## First success milestone

The first milestone is not a finished coding agent. It is a verified Windows TUI spike plus a verified BharatCode streaming/tool-call test, followed by an agreed repository structure. Once those pass, proceed through `implementation_plan.md`.
