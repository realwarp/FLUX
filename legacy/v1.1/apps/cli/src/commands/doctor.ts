import { existsSync } from "node:fs";
import path from "node:path";
import { FLUX_VERSION } from "@flux/app-core";
import { FluxApp } from "@flux/app-core";
import { boolFlag, openApp, paint, parseArgs } from "../common.ts";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  fatal: boolean;
}

function openTuiNativePackage(): { ok: boolean; detail: string } {
  const name = `core-${process.platform}-${process.arch}`;
  try {
    const coreEntry = Bun.resolveSync("@opentui/core", process.cwd());
    const sibling = path.resolve(path.dirname(coreEntry), "..", name);
    if (existsSync(sibling)) return { ok: true, detail: sibling };
    const resolved = Bun.resolveSync(`@opentui/${name}`, path.dirname(coreEntry));
    return { ok: true, detail: resolved };
  } catch {
    return {
      ok: false,
      detail: `@opentui/${name} not found; run bun install with network access`,
    };
  }
}

function commandVersion(command: string): string | undefined {
  try {
    const result = Bun.spawnSync([command, "--version"], { stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) return undefined;
    return result.stdout.toString().trim().split("\n")[0];
  } catch {
    return undefined;
  }
}

export async function doctorCommand(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const json = boolFlag(flags, "json");
  const checks: Check[] = [];

  const bunVersion = typeof Bun !== "undefined" ? Bun.version : "unavailable";
  const [major = 0, minor = 0, patch = 0] = bunVersion.split(".").map(Number);
  const bunOk = major > 1 || (major === 1 && (minor > 3 || (minor === 3 && patch >= 14)));
  checks.push({
    name: "Bun runtime",
    ok: bunOk,
    detail: `${bunVersion} on ${process.platform}-${process.arch} (OpenTUI needs >= 1.3.14)`,
    fatal: true,
  });

  checks.push({
    name: "Operating system",
    ok: process.platform === "win32" || process.platform === "linux" || process.platform === "darwin",
    detail: `${process.platform} ${process.arch}`,
    fatal: false,
  });

  const git = commandVersion("git");
  checks.push({ name: "Git", ok: Boolean(git), detail: git ?? "not found", fatal: true });

  const rg = commandVersion("rg");
  checks.push({ name: "ripgrep (optional)", ok: Boolean(rg), detail: rg ?? "not found; portable fallback will be used", fatal: false });

  let app: FluxApp | undefined;
  try {
    app = await openApp();
    const current = app;
    const config = current.config;
    checks.push({
      name: "User config",
      ok: existsSync(current.paths.configFile),
      detail: current.paths.configFile,
      fatal: false,
    });
    checks.push({
      name: "SQLite database",
      ok: true,
      detail: `${current.paths.dbFile} (schema v${current.db.schemaVersion()})`,
      fatal: true,
    });
    checks.push({
      name: "Repository root",
      ok: true,
      detail: `${current.repo.root}${current.repo.isGit ? " (git)" : " (no git)"}`,
      fatal: false,
    });
    checks.push({
      name: "Provider profiles",
      ok: config.providers.some((profile) => profile.enabled),
      detail: config.providers.length === 0
        ? "none configured; run `flux auth`"
        : config.providers
            .map((profile) => `${profile.id}${profile.enabled ? "" : " (disabled)"}${current.credentialStatus(profile) ? "" : " [credential missing]"}`)
            .join(", "),
      fatal: false,
    });
    checks.push({
      name: "Default model",
      ok: Boolean(config.defaultModel),
      detail: config.defaultModel
        ? `${config.defaultModel.providerProfileId} / ${config.defaultModel.modelId}`
        : "not selected; run `flux models use <provider> <model>`",
      fatal: false,
    });
    checks.push({
      name: "Permission mode",
      ok: true,
      detail: config.ui.permissionMode ?? "ask (writes and commands need approval)",
      fatal: false,
    });
    checks.push({
      name: "Fallback",
      ok: true,
      detail: config.fallback.enabled
        ? `enabled: ${config.fallback.chain.map((ref) => `${ref.providerProfileId}/${ref.modelId}`).join(" -> ")}`
        : "disabled (opt-in)",
      fatal: false,
    });
    const budgets = config.budgets;
    checks.push({
      name: "Budgets",
      ok: true,
      detail:
        budgets.sessionTokens || budgets.sessionRequests || budgets.taskTokens || budgets.taskRequests
          ? `session tokens=${budgets.sessionTokens ?? "-"} requests=${budgets.sessionRequests ?? "-"} task tokens=${budgets.taskTokens ?? "-"}`
          : "not configured",
      fatal: false,
    });
  } catch (error) {
    checks.push({
      name: "Application wiring",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      fatal: true,
    });
  } finally {
    app?.close();
  }

  checks.push({ name: "OpenTUI native package", ...openTuiNativePackage(), fatal: false });

  const failedFatal = checks.filter((check) => check.fatal && !check.ok);

  if (json) {
    process.stdout.write(`${JSON.stringify({ version: FLUX_VERSION, checks, ok: failedFatal.length === 0 }, null, 2)}\n`);
  } else {
    process.stdout.write(`${paint.bold(`FLUX doctor${" ".repeat(2)}v${FLUX_VERSION}`)}\n\n`);
    for (const check of checks) {
      const mark = check.ok ? paint.green("PASS") : check.fatal ? paint.red("FAIL") : paint.yellow("WARN");
      process.stdout.write(`${mark}  ${check.name}: ${check.detail}\n`);
    }
    process.stdout.write(
      `\n${failedFatal.length === 0 ? paint.green("Environment is ready.") : paint.red(`${failedFatal.length} blocking issue(s).`)}\n`,
    );
  }

  if (failedFatal.length > 0) process.exitCode = 1;
}
