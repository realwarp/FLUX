# Safety boundaries

FLUX tools act on the workspace selected when the application starts. The model provider does not grant itself permissions; FLUX checks its own policy before each operation.

## Tool behavior

- **Read and search:** operate on workspace paths. Resolution checks lexical containment and existing symlink targets; unsafe escapes are rejected.
- **Write and patch:** require FLUX approval before execution. Patch application validates its target and hunk matches; failed patches do not report success.
- **Shell:** requires approval, runs from the workspace root, has a timeout and bounded output, and rejects obvious absolute/out-of-workspace path forms.

Shell is not a sandbox. It runs under the current operating-system account and inherits that account's permissions. Command validation is not a substitute for reviewing the command and its effects. `--approve` automatically permits writes, patches, and shell for the entire run; it should be used only when that broader approval is intended.

Operating-system permissions remain authoritative. FLUX cannot bypass filesystem ACLs or permissions, and approval does not grant access the operating system denies.

## Data and provider boundaries

Session conversations and FLUX approval/verification records are stored locally without encryption. Avoid placing secrets in prompts, source files, command output, or session content. Setup stores an API-key environment-variable name rather than the key value; environment variables still depend on the host's own access controls.

Prompts and relevant workspace context are sent to the configured provider. A loopback URL or installed local model list does not prove that inference is never forwarded. Review the provider's behavior and privacy terms.

## Known limitations

- FLUX v0.1.0 is early access; provider compatibility varies.
- Shell execution is bounded but is not isolated from the host.
- Configuration and sessions are not encrypted.
- Windows ACL checks and interactive terminal behavior require platform-specific verification; see the development taskboard for current evidence.
