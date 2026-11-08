# Setup and configuration

## Requirements

Use an interactive terminal on a supported platform. The installer checks for Bun 1.4.4 or newer and can install it with the official Bun installer after confirmation. The release archive contains the compiled FLUX application; installation does not clone the repository or run its build script.

For a release-candidate test, set `FLUX_VERSION` to the exact tag before running the installer. This opts into a prerelease instead of the latest stable release:

```powershell
$env:FLUX_VERSION = "v0.1.0-rc.1"
irm https://raw.githubusercontent.com/realwarp/FLUX/main/install.ps1 | iex
```

```bash
export FLUX_VERSION=v0.1.0-rc.1
curl -fsSL https://raw.githubusercontent.com/realwarp/FLUX/main/install.sh | bash
```

## Guided setup

Run `flux` after installation. If no provider/model is configured, FLUX opens setup. Use `flux setup` to reconfigure:

1. Choose Ollama or an OpenAI-compatible provider.
2. Enter or accept the endpoint URL.
3. Select an installed Ollama model or enter the hosted model ID.
4. Let FLUX test the selected model before it saves the configuration.

### Ollama

Install and start Ollama separately. Setup queries its `/api/tags` endpoint and lists only models returned by that endpoint. If the list is empty, setup asks for a model ID and requires explicit confirmation before invoking `ollama pull`. Model weights are not part of FLUX's release package and can require several gigabytes of storage and network transfer.

The connection test sends a short prompt with a one-token output limit to the selected installed model. It does not silently pull or switch models.

### OpenAI-compatible endpoints

Enter the endpoint base URL, a display name, and the exact model ID. Setup sends a one-token chat-completion request to test the endpoint and credentials.

Enter the name of an environment variable that contains the API key (default `OPENAI_API_KEY`). Do not paste the key into setup or a prompt. FLUX stores the variable name in its user config, not its value. Set the variable in the environment before running setup; a missing or rejected credential prevents setup from saving the provider as active.

PowerShell example for the current terminal:

```powershell
$env:OPENAI_API_KEY = "your-key"
flux setup
```

macOS/Linux shell example for the current terminal:

```bash
export OPENAI_API_KEY="your-key"
flux setup
```

Environment values take precedence over JSON configuration. `FLUX_PROVIDER` and `FLUX_MODEL` select the default; provider-specific variables such as `OPENAI_BASE_URL`, `OPENAI_MODEL`, and `OPENAI_API_KEY` override provider settings. Ollama accepts `OLLAMA_HOST` as a base-URL override.

## Configuration and saved data

The user configuration is stored at `%LOCALAPPDATA%\FLUX\config.json` on Windows and `${XDG_CONFIG_HOME:-$HOME/.config}/flux/config.json` on macOS/Linux. Setup writes configuration atomically with a private file mode where supported and omits resolved API-key values.

Conversation/session data and FLUX approval/verification records are stored in the user's profile. They are not encrypted. The installer uses versioned application directories and does not remove configuration or session data during upgrades.

## Troubleshooting

- **Ollama not reachable:** start Ollama and verify the configured base URL. Setup does not install Ollama.
- **No Ollama models:** confirm a model pull only if you intend to download the displayed model and have sufficient disk space.
- **Model test fails:** confirm the exact model ID and endpoint; for Ollama, confirm it appears in the installed model list.
- **OpenAI-compatible authentication fails:** confirm the named environment variable exists in the same terminal that runs `flux setup`. FLUX does not persist its value.
- **Malformed configuration:** run `flux setup` interactively; invalid JSON is reported with the config path.
- **Non-interactive startup without a model:** run `flux setup` from an interactive terminal first. FLUX does not select an unrelated model as a fallback.

## Uninstall

Remove application files only:

- Windows: `%LOCALAPPDATA%\Programs\FLUX` and `%LOCALAPPDATA%\FLUX\bin\flux.cmd`.
- macOS/Linux: `${XDG_DATA_HOME:-$HOME/.local/share}/flux` and `$HOME/.local/bin/flux`.

Remove the installer's PATH entry if desired. Delete configuration and saved sessions separately only if you intend to erase them.
