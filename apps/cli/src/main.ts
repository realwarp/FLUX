import { FLUX_VERSION } from "@flux/app-core";
import { FluxError } from "@flux/shared";
import { boolFlag, parseArgs, stringFlag } from "./common.ts";
import { authCommand } from "./commands/auth.ts";
import { doctorCommand } from "./commands/doctor.ts";
import { modelsCommand } from "./commands/models.ts";
import { providersCommand } from "./commands/providers.ts";
import { runCommand } from "./commands/run.ts";
import { sessionsCommand } from "./commands/sessions.ts";
import { usageCommand } from "./commands/usage.ts";

const HELP = `FLUX — terminal-native AI coding agent

Usage:
  flux                      Launch the interactive TUI in the current directory
  flux resume <session-id>  Resume a saved session in the TUI
  flux run "<prompt>"       Run one non-interactive turn
  flux doctor               Check runtime, config, provider and Git readiness
  flux auth                 Guided provider setup (no secrets stored)
  flux providers            List, add, test, enable, disable or remove profiles
  flux models               List models, choose the default, set per-role overrides
  flux usage                Show token usage and budget status
  flux sessions             List, show or delete saved sessions

Common flags:
  --session <id>       Continue an existing session
  --yes                Approve writes/commands in a non-interactive run (explicit opt-in)
  --read-only          Deny all writes and shell commands
  --accept-edits       Allow writes and commands without prompting (this session only)
  --max-steps <n>      Bound the agent loop
  --json               Machine-readable output where supported
  --version, -v        Print the version
  --help, -h           Print this help

Environment:
  FLUX_HOME            Override the user config/data directory (default: %APPDATA%\\flux)
  Provider credentials are referenced as env:VARIABLE_NAME and resolved at request time.

Safety:
  Default mode is "ask": reads are allowed, writes and shell commands need approval.
  Destructive commands (git reset --hard, force-push, broad deletes) are always denied.
`;

export async function main(argv: string[]): Promise<void> {
  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`${FLUX_VERSION}\n`);
    return;
  }
  if (argv.includes("--help") || argv.includes("-h") || argv[0] === "help") {
    process.stdout.write(HELP);
    return;
  }

  const command = argv[0];
  const rest = argv.slice(1);

  switch (command) {
    case undefined:
      await launchTui(rest);
      return;
    case "doctor":
      await doctorCommand(rest);
      return;
    case "auth":
      await authCommand(rest);
      return;
    case "providers":
      await providersCommand(rest);
      return;
    case "models":
      await modelsCommand(rest);
      return;
    case "usage":
      await usageCommand(rest);
      return;
    case "sessions":
      await sessionsCommand(rest);
      return;
    case "run":
      await runCommand(rest);
      return;
    case "resume": {
      const sessionId = rest[0];
      if (!sessionId) throw new FluxError("config", "Usage: flux resume <session-id>");
      await launchTui(["--session", sessionId]);
      return;
    }
    default:
      // Treat an unknown bare word as a TUI prompt, matching `flux "fix the build"`.
      if (!command.startsWith("-")) {
        await launchTui(argv);
        return;
      }
      throw new FluxError("config", `Unknown option: ${command}. Run \`flux --help\`.`);
  }
}

async function launchTui(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new FluxError(
      "config",
      "The TUI needs an interactive terminal. Use `flux run \"...\"` for non-interactive use.",
    );
  }
  const sessionId = stringFlag(flags, "session");
  const readOnly = boolFlag(flags, "read-only");
  const acceptEdits = boolFlag(flags, "accept-edits");
  const module = await import("@flux/tui");
  await module.launchTui({
    cwd: process.cwd(),
    sessionId,
    permissionMode: readOnly ? "read-only" : acceptEdits ? "accept-edits" : undefined,
  });
}
