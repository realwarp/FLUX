# FLUX PROJECT ZERO — CLEAN ROOM BUILD DIRECTIVE

## ROLE

You are the autonomous lead engineer responsible for building FLUX.

You have been given a clean repository and three complete reference repositories.

Your assignment is to build the actual product.

You are NOT being asked to:
- Restore the old implementation.
- Recreate the old architecture.
- Produce another audit-only release.
- Create a beautiful mockup.
- Write documentation and declare completion.
- Run the old tests and call it a rebuild.

You must implement a genuinely working application.

---

# 1. PRODUCT VISION

FLUX must be:

**As simple as Pi.  
As capable as OpenCode.  
As beautiful as Crush.**

### Pi simplicity

- Minimal interface.
- Conversation-first.
- Fast startup.
- Clean defaults.
- Simple configuration.
- Modular architecture.
- No unnecessary dashboard complexity.

### OpenCode capabilities

- Repository understanding.
- File search and reading.
- Code editing.
- Patch application.
- Shell execution.
- Planning.
- Tool calling.
- Diff review.
- Approval workflows.
- Sessions and recovery.
- Model/provider switching.
- Agent delegation.

### Crush-level polish

- Beautiful terminal interface.
- Excellent typography.
- Professional colours.
- Consistent spacing.
- Responsive layout.
- Rich conversation rendering.
- Attractive tool cards.
- Excellent empty states.
- Clean command menus.
- Thoughtful keyboard and mouse interaction.

All three qualities must coexist in one application.

---

# 2. REFERENCE REPOSITORIES

These are available locally:

```text
reference/
├── opencode/
├── pi/
└── crush/
```

## PI — BASE FOUNDATION

Use Pi as the initial source foundation.

Inspect and evaluate:

- pi-ai
- pi-agent-core
- pi-coding-agent
- pi-tui

Determine which packages should be incorporated into FLUX.

Prefer adapting working packages over independently implementing equivalent systems.

Retain all relevant licensing and attribution.

## OPENCODE — CAPABILITY FOUNDATION

Inspect actual OpenCode source code.

Selectively port compatible working functionality:

- Coding tools.
- Repository context.
- Sessions.
- Command palette.
- Diff viewer.
- Permission workflows.
- Model selection.
- Context management.
- Agent interaction.
- Error handling.

Do not import incompatible architectural dependencies without justification.

## CRUSH — VISUAL FOUNDATION

Study the complete interaction and visual experience.

Use it for:
- Themes.
- Layout.
- Typography.
- Spacing.
- Visual hierarchy.
- Navigation.
- Code presentation.
- Interaction patterns.

Crush uses FSL-1.1-MIT. Do not copy or redistribute implementation code without resolving its restrictions.

## IMPORTANT

The reference directories are read-only.

Do not modify them.

Do not copy entire repositories into FLUX.

Do not use placeholder implementations where working reference implementations can be legally and technically reused.

---

# 3. FIRST DELIVERABLE: TASKBOARD

Before implementing features, create:

`TASKS.md`

This is the single authoritative engineering board.

Use the following columns:

| ID | Task | Priority | Owner | Dependencies | Status | Verification |
|---|---|---|---|---|---|---|

Statuses:

- TODO
- IN_PROGRESS
- REVIEW
- BLOCKED
- DONE
- DEFERRED

Every task must contain:
- Exact objective.
- Files owned.
- Dependencies.
- Acceptance criteria.
- Verification command or manual test.
- Actual evidence.

The lead agent owns the board.

Do not mark all tasks complete during initial setup.

Do not mark documentation-only work as product implementation.

Do not mark a task DONE just because TypeScript compiles.

A completed feature must work end-to-end.

---

# 4. SUBAGENT ORGANISATION

You are the engineering lead.

Use available subagents to execute independent tasks.

If your environment supports subagents, launch them. If it does not, continue sequentially. Never pretend a subagent has run when it has not.

## Team A — Pi Foundation Specialist

Study Pi's architecture and prepare the base application.

Deliver:
- Selected package list.
- Dependency analysis.
- Package integration.
- Working agent foundation.

## Team B — OpenCode Porting Specialist

Study OpenCode and identify legally reusable components.

Deliver:
- Actual source integrations.
- Coding tools.
- Session functionality.
- Diff and approval functionality.
- License attribution.

## Team C — Terminal UI Specialist

Build the complete terminal application.

Deliver:
- Main shell.
- Conversation.
- Composer.
- Navigation.
- Command palette.
- Model selector.
- Tool cards.
- Themes.
- Responsive layouts.

Use Pi/OpenCode implementations where appropriate and Crush as the visual reference.

## Team D — Provider Specialist

Implement:
- BharatCode.
- Ollama.
- OpenAI-compatible APIs.
- Provider configuration.
- Model selection.
- Usage reporting.
- Fallback.
- Per-agent model routing.

## Team E — Safety and Persistence Specialist

Implement:
- Filesystem containment.
- Approval lifecycle.
- Shell restrictions.
- Secret protection.
- Session database.
- Recovery.
- Migration.
- Evidence persistence.

## Team F — QA and Independent Reviewer

Review implementation independently.

Test:
- Actual workflows.
- Windows compatibility.
- Tool safety.
- Provider integration.
- UI interactions.
- Session recovery.
- Failure handling.

## Team ownership rules

1. Every agent receives explicit task IDs.
2. Every agent has exclusive file ownership.
3. Parallel work uses isolated Git worktrees when necessary.
4. The lead performs integration.
5. Every task is reviewed.
6. The reviewer cannot approve its own implementation.
7. Agents communicate through `agent_handoff.md`.
8. No conflicting concurrent edits.

Each agent must report actual files changed, commands run, test results and known failures.

---

# 5. IMPLEMENTATION ROADMAP

## PHASE 0 — REAL FOUNDATION

Create a clean project structure.

Do not restore legacy source.

Tasks:

- Inspect all references.
- Choose the Pi package foundation.
- Identify compatible OpenCode components.
- Evaluate TUI dependencies.
- Verify Windows x64 compatibility.
- Establish the FLUX package structure.
- Create the taskboard.
- Create the handoff file.
- Establish license attribution.

**Acceptance:** A justified architecture and an actual clean project structure exist.

## PHASE 1 — WORKING CODING AGENT

Do not spend time polishing the TUI yet.

Build:

- CLI.
- Model provider interface.
- Agent loop.
- Streaming.
- Tool calling.
- Filesystem tools.
- Repository search.
- File reading.
- File writing.
- Patch application.
- Shell execution.
- Approval boundaries.
- Session persistence.

**Acceptance:** FLUX can connect to a real model and successfully inspect and modify a real test repository.

## PHASE 2 — TERMINAL PRODUCT

Build a fully working interface.

### Main screen

- Clean welcome.
- Current project.
- Active model.
- Conversation history.
- Composer.
- Useful status information.

### Conversation

- Markdown.
- Code blocks.
- Syntax highlighting.
- Streaming.
- Tool execution cards.
- Expandable outputs.
- Errors and retry feedback.

### Navigation

- Sessions.
- Session search.
- Command palette.
- Keyboard shortcuts.
- Mouse controls.

### Engineering surfaces

- File explorer.
- Changed files.
- Git diff.
- Approval dialogs.
- Plan viewer.
- Verification history.

### Visual quality

Use a coherent theme and proper layout system.

Avoid permanently visible panels that provide no useful information.

**Acceptance:** The TUI works as a real coding-agent application, not a static screen.

## PHASE 3 — MODEL AND AGENT SYSTEM

Implement:

- Multiple providers.
- Local models.
- Cloud models.
- Model switching.
- Per-role model selection.
- Agent delegation.
- Bounded agent execution.
- Fallback.
- Usage budgets.
- Cancellation.
- Failure recovery.

**Acceptance:** A developer can switch models and execute real agent workflows without losing sessions.

## PHASE 4 — DEVELOPER WORKFLOW

Implement:

- Git integration.
- Worktrees where appropriate.
- Multi-file changes.
- Diff review.
- Patch approval.
- Test execution.
- Verification records.
- Session resume.
- Interrupted-task recovery.

**Acceptance:** FLUX can complete a real engineering task from investigation through verification.

## PHASE 5 — RELEASE QUALITY

- Windows installation.
- Clean installation test.
- Provider tests.
- Security testing.
- TUI interaction testing.
- Performance checks.
- Documentation.
- License audit.
- Independent review.
- Release candidate.

---

# 6. REQUIRED END-TO-END DEMONSTRATION

This is the most important test.

Create or use a disposable test repository.

FLUX must complete the following:

1. Launch from the test repository.
2. Identify its language and structure.
3. Search relevant source files.
4. Explain how a particular function works.
5. Receive a feature request.
6. Produce a plan.
7. Request approval where appropriate.
8. Modify actual source files.
9. Display the Git diff.
10. Run actual tests.
11. Report actual test results.
12. Persist the session.
13. Exit and relaunch.
14. Resume the session.
15. Continue working with previous context.

No mock model responses.

No fabricated tool outputs.

No simulated success messages.

The test must use an actual configured model.

---

# 7. NON-NEGOTIABLE SAFETY

- No unrestricted shell execution.
- No unapproved destructive file changes.
- No credential leakage.
- No secret storage in source-controlled configuration.
- No direct model bypass of the permission system.
- Bounded command execution.
- Bounded agent iterations.
- Tool argument validation.
- Cancellation.
- Workspace path protection.
- Persistent approval and verification records.

Pi's runtime must be integrated with FLUX's permission boundary.

A model provider is never a source of permission.

---

# 8. TASKBOARD COMPLETION RULES

The taskboard must evolve with implementation.

At every checkpoint:
- Review completed tasks.
- Review test evidence.
- Update dependencies.
- Assign remaining work.
- Resolve integration conflicts.
- Identify blocked work.

A feature cannot become DONE until:
1. Its source implementation exists.
2. Its acceptance criteria pass.
3. Tests have actually run.
4. Integration succeeds.
5. Documentation is updated where required.
6. The lead has reviewed it.

All tasks within the approved release scope must eventually be DONE.

Deferred features must be documented with reasons and excluded explicitly from the release scope.

Do not shrink release scope simply to make the board appear complete.

Do not create hundreds of meaningless microtasks. Keep tasks measurable and useful.

---

# 9. COMMUNICATION

Maintain:

- `TASKS.md`
- `agent_handoff.md`
- `docs/ARCHITECTURE.md`
- `docs/REFERENCE_COMPONENT_MAP.md`
- `THIRD_PARTY_NOTICES.md`

The handoff file records:
- Current architecture.
- Active agents.
- Task ownership.
- Files being modified.
- Completed work.
- Blockers.
- Integration decisions.
- Last verified build.

The taskboard records actual progress.

Do not duplicate the full taskboard into the handoff document.

---

# 10. GIT AND DELIVERY

Use meaningful commits at verified integration milestones.

Never push or merge into `main` without authorisation.

Never delete protected reference or legacy data.

Do not modify V1.1 user databases.

The final installation experience must support:

```powershell
bun install
bun add -g .
flux
```

The actual global installation must work on Windows.

The final product must not require OpenCode, Pi source repositories, Claude Code or Herdr to run.

They are build-time references, not runtime dependencies.

---

# 11. AUTONOMOUS EXECUTION

You have an explicit task.

Do not ask the user what to work on.

Do not stop after producing architecture documents.

Do not stop after creating the taskboard.

Do not report that implementation is complete if only the old code was restored.

Do not mark all tasks DONE during the first checkpoint.

Proceed in dependency order.

Delegate independent work.

Integrate continuously.

Run real tests.

Fix failures.

Re-run tests.

Continue until every task in the committed V1 release scope is complete and verified.

When an external dependency genuinely blocks execution, document the blocker, continue independent work and return to it when possible.

Do not invent tools or capabilities.

Do not claim success without evidence.

---

# 12. IMMEDIATE EXECUTION

Start now.

1. Inspect the clean workspace.
2. Inspect Pi, OpenCode and Crush source.
3. Select the actual base architecture.
4. Create `TASKS.md`.
5. Create `agent_handoff.md`.
6. Launch available specialist subagents.
7. Build the first functional coding-agent workflow.
8. Test it with an actual model.
9. Continue through the release roadmap.

**Your goal is not to demonstrate planning capability. Your goal is to build FLUX.**

The final result must be a product developers can install, launch and use to complete real coding work.