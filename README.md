# FLUX

**FLUX v0.1.0 — early access**

A terminal coding assistant for exploring and changing a project with an AI model you choose.

**Live website:** [warpie.link/flux](https://warpie.link/flux)

## Install

**Windows PowerShell**

```powershell
irm https://raw.githubusercontent.com/realwarp/FLUX/main/install.ps1 | iex
```

**macOS or Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/realwarp/FLUX/main/install.sh | bash
```

The installer checks for Bun and asks before installing it. It downloads a published FLUX release and verifies its SHA-256 checksum before installing. The v0.1.0 release is not published yet; these commands become usable after release assets are available.

## First run

Run `flux` in the project directory. On first launch, FLUX guides you through choosing Ollama or an OpenAI-compatible endpoint, selecting a model, testing the connection, and saving the configuration. Run `flux setup` to repeat setup.

Ollama must be installed and running. FLUX lists only installed models. If none are available, setup can offer to run an explicitly confirmed `ollama pull`; model downloads may be several gigabytes. For hosted endpoints, set the requested API-key environment variable before testing. FLUX saves the variable name, not the key value.

## What FLUX does

- Reads and searches files inside the selected workspace.
- Applies file writes and patches only after approval.
- Runs bounded shell commands only after approval.
- Keeps workspace sessions and restores previous conversations.
- Supports Ollama and OpenAI-compatible providers.
- Provides a searchable command palette, model selector, and diff view.

## Safety and data

Read/search are workspace-contained. Writes, patches, and shell commands require approval in the interactive interface. `--approve` automatically approves all three for that run; use it only in a workspace where that is acceptable. Shell execution runs with the current user's operating-system permissions and is not a security sandbox.

Session contents are stored locally and are not encrypted. Do not include passwords, API keys, or other secrets in prompts, source files, or command output. Provider requests may send relevant conversation and workspace context to the configured endpoint. A loopback endpoint alone does not prove that inference is never forwarded.

See [Safety](docs/SAFETY.md) for the actual boundaries and limitations.

## Screenshot

The FLUX terminal home screen:

![FLUX terminal home screen](website/assets/flux-home.png)

The [live website](https://warpie.link/flux) includes the product overview and interface showcase.

## Platforms

The current release matrix targets Windows x64, Linux x64, and macOS ARM64 (Apple Silicon). Intel macOS and Linux ARM64 are not packaged by this workflow, and the Unix installer rejects those architectures rather than downloading a nonexistent asset. These are early-access builds; check the Actions results for the exact commit before installing.

## Troubleshooting and uninstall

- **`flux` is not found:** open a new terminal so the installer-added PATH entry is loaded. On Unix, check that `$HOME/.local/bin` is on PATH.
- **Bun is missing or old:** rerun the installer and accept its official Bun installation prompt.
- **Ollama cannot be reached:** install/start Ollama, then run `flux setup`.
- **Model is missing:** select an installed model in setup, or explicitly confirm the offered Ollama download.
- **Provider test fails:** check the base URL, model ID, and the named credential environment variable, then run `flux setup`.
- **A change is denied:** launch in an interactive terminal and review the operation. Without an interactive approval handler, mutations are denied unless `--approve` was explicitly supplied.

To uninstall the application files, remove `%LOCALAPPDATA%\Programs\FLUX` and `%LOCALAPPDATA%\FLUX\bin\flux.cmd` on Windows, or `$HOME/.local/share/flux` and `$HOME/.local/bin/flux` on macOS/Linux. Remove the installer-added PATH entry if desired. Configuration and saved sessions are kept separately and are not deleted by an upgrade or by these commands.

Detailed [setup](docs/SETUP.md), [architecture](docs/ARCHITECTURE.md), and [license](LICENSE) information is available in `docs/`.
