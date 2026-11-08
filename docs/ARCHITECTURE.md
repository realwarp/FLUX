# FLUX Architecture

## Foundation

FLUX uses the published MIT-licensed Pi packages for model streaming, the agent loop, sessions, and terminal UI. FLUX owns provider configuration, workspace containment, approval decisions, local approval/verification records, and its visual identity. OpenCode informed selected workflows; Crush informed visual hierarchy only. Neither is a runtime dependency, and no Crush implementation code is included.

## Runtime shape

```text
flux CLI / terminal UI
  -> user configuration and provider readiness
  -> Pi AgentSession and SessionManager
  -> FLUX workspace, validation, and approval policy
  -> FLUX read/search/write/patch/shell tools
  -> local conversation, approval, and verification records
```

The application uses the process working directory as the workspace unless `--cwd` selects another path. The provider and model are selected from FLUX configuration; a missing configured model is not silently replaced.

## Distribution

The release artifact contains compiled `dist/`, the package manifest, and the Bun lockfile. The installer verifies the release SHA-256 checksum, installs Bun only after consent, and installs locked runtime dependencies with lifecycle scripts disabled. It does not clone the repository or run the build during installation.

The launchers require Bun 1.4.4 or newer. The package metadata also declares Node.js 22.19 or newer for Node-based package-manager use. Platform support is limited to release targets whose automated checks pass; see the root README and release workflow.

## Data and compatibility

Configuration, conversation sessions, and FLUX approval/verification records are stored in the user's profile. They are not encrypted. FLUX does not migrate the legacy v1.1 databases or source tree.
