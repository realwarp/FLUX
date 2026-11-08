import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { FluxError, emptyConfig, parseConfig, zodMessage, type FluxConfig } from "@flux/shared";

export interface FluxPaths {
  home: string;
  configFile: string;
  dbFile: string;
}

/** Deterministic, user-scoped paths. FLUX_HOME overrides for tests/portable use. */
export function resolveFluxPaths(env: NodeJS.ProcessEnv = process.env): FluxPaths {
  const override = env["FLUX_HOME"];
  const home =
    override && override.trim().length > 0
      ? path.resolve(override)
      : process.platform === "win32"
        ? path.join(env["APPDATA"] ?? path.join(homedir(), "AppData", "Roaming"), "flux")
        : path.join(env["XDG_CONFIG_HOME"] ?? path.join(homedir(), ".config"), "flux");
  return {
    home,
    configFile: path.join(home, "config.json"),
    dbFile: path.join(home, "flux.sqlite"),
  };
}

interface ProjectConfig {
  defaultModel?: FluxConfig["defaultModel"];
  roles?: FluxConfig["roles"];
  fallback?: FluxConfig["fallback"];
  budgets?: FluxConfig["budgets"];
  ui?: FluxConfig["ui"];
}

/**
 * Loads user config and merges a non-secret project override from
 * `<workspace>/.flux/config.json`. Project files may select provider/model IDs
 * but may never add providers or credentials.
 */
export class ConfigManager {
  constructor(
    readonly paths: FluxPaths,
    private readonly cwd: string = process.cwd(),
  ) {}

  configPath(): string {
    return this.paths.configFile;
  }

  projectConfigPath(): string {
    return path.join(this.cwd, ".flux", "config.json");
  }

  exists(): boolean {
    try {
      readFileSync(this.paths.configFile, "utf8");
      return true;
    } catch {
      return false;
    }
  }

  loadUser(): FluxConfig {
    let raw: string;
    try {
      raw = readFileSync(this.paths.configFile, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return emptyConfig();
      throw new FluxError("config", `Could not read ${this.paths.configFile}: ${code ?? "unknown error"}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new FluxError("config", `Invalid JSON in ${this.paths.configFile}.`);
    }
    try {
      return parseConfig(parsed);
    } catch (error) {
      throw new FluxError("config", `Invalid config: ${zodMessage(error)}`);
    }
  }

  loadProject(): ProjectConfig | undefined {
    let raw: string;
    try {
      raw = readFileSync(this.projectConfigPath(), "utf8");
    } catch {
      return undefined;
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if ("providers" in parsed) {
        throw new FluxError("config", "Project .flux/config.json must not define providers or credentials.");
      }
      return {
        defaultModel: parsed["defaultModel"] as ProjectConfig["defaultModel"],
        roles: parsed["roles"] as ProjectConfig["roles"],
        fallback: parsed["fallback"] as ProjectConfig["fallback"],
        budgets: parsed["budgets"] as ProjectConfig["budgets"],
        ui: parsed["ui"] as ProjectConfig["ui"],
      };
    } catch (error) {
      if (error instanceof FluxError) throw error;
      throw new FluxError("config", `Invalid project config: ${zodMessage(error)}`);
    }
  }

  applyProject(user: FluxConfig): FluxConfig {
    const project = this.loadProject();
    if (!project) return user;
    return {
      ...user,
      defaultModel: project.defaultModel ?? user.defaultModel,
      roles: { ...user.roles, ...(project.roles ?? {}) },
      fallback: project.fallback ?? user.fallback,
      budgets: { ...user.budgets, ...(project.budgets ?? {}) },
      ui: { ...user.ui, ...(project.ui ?? {}) },
    };
  }

  load(): FluxConfig {
    return this.applyProject(this.loadUser());
  }

  save(config: FluxConfig): void {
    mkdirSync(this.paths.home, { recursive: true });
    const tmp = `${this.paths.configFile}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    renameSync(tmp, this.paths.configFile);
  }
}

export function ensureFluxHome(paths: FluxPaths): void {
  mkdirSync(paths.home, { recursive: true });
}
