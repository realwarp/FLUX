// Provider configuration loaded from environment and a local JSON file.
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";

export type ProviderName = "ollama" | "openai-compatible" | "bharatcode";

export interface ProviderConfig {
  name: ProviderName;
  model: string;
  baseUrl: string;
  apiKey?: string;
  credentialEnv?: string;
  displayName?: string;
  enabled: boolean;
}

export interface FluxConfig {
  providers: Partial<Record<ProviderName, ProviderConfig>>;
  defaultProvider?: ProviderName;
  defaultModel?: string;
}

const defaults: Record<ProviderName, Omit<ProviderConfig, "name">> = {
  ollama: { model: "", baseUrl: "http://127.0.0.1:11434/v1", enabled: true },
  "openai-compatible": { model: "", baseUrl: "https://api.openai.com/v1", enabled: true },
  bharatcode: { model: "", baseUrl: "https://api.bharatgen.ai/v1", enabled: true },
};

/** Loads FLUX provider settings, with environment values taking precedence. */
export async function loadConfig(path = defaultConfigPath()): Promise<FluxConfig> {
  let fileConfig: Partial<FluxConfig> = {};
  try {
    fileConfig = parseConfig(JSON.parse(await readFile(path, "utf8")), path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const providers = Object.fromEntries(
    (Object.keys(defaults) as ProviderName[]).map((name) => {
      const configured = fileConfig.providers?.[name];
      const prefix = name === "openai-compatible" ? "OPENAI" : name.toUpperCase();
      const baseUrl = process.env[`${prefix}_BASE_URL`] ??
        (name === "ollama" ? process.env.OLLAMA_HOST : undefined) ??
        configured?.baseUrl ?? defaults[name].baseUrl;
      const value: ProviderConfig = {
        name,
        ...defaults[name],
        ...configured,
        model: process.env[`${prefix}_MODEL`] ?? configured?.model ?? defaults[name].model,
        baseUrl,
        apiKey: process.env[`${prefix}_API_KEY`] ??
          (configured?.credentialEnv ? process.env[configured.credentialEnv] : undefined) ??
          configured?.apiKey,
        credentialEnv: configured?.credentialEnv,
        displayName: configured?.displayName,
        enabled: process.env[`${prefix}_ENABLED`] !== "false" && (configured?.enabled ?? true),
      };
      return [name, value];
    }),
  ) as FluxConfig["providers"];

  const defaultProvider = (process.env.FLUX_PROVIDER ?? fileConfig.defaultProvider) as ProviderName | undefined;
  return {
    providers,
    defaultProvider,
    defaultModel: process.env.FLUX_MODEL ?? fileConfig.defaultModel,
  };
}

export const loadProviderConfig = loadConfig;

export function defaultConfigPath(): string {
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "FLUX", "config.json");
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "flux", "config.json");
}

export async function hasConfigFile(path = defaultConfigPath()): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new Error(`Cannot access FLUX configuration at "${path}".`, { cause: error });
  }
}

export async function saveConfig(config: FluxConfig, path = defaultConfigPath()): Promise<void> {
  const providers = Object.fromEntries(
    (Object.keys(defaults) as ProviderName[]).flatMap((name) => {
      const provider = config.providers[name];
      if (!provider) return [];
      if (containsUrlCredentials(provider.baseUrl)) {
        throw new Error("Provider URLs cannot contain credentials, query parameters, or fragments; use a credential environment-variable reference instead.");
      }
      const safeProvider = { ...provider };
      delete safeProvider.apiKey;
      return [[name, safeProvider]];
    }),
  );
  const contents = `${JSON.stringify({
    defaultProvider: config.defaultProvider,
    defaultModel: config.defaultModel,
    providers,
  }, null, 2)}\n`;
  const temporary = `${path}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporary, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    try {
      await unlink(temporary);
    } catch (cleanupError) {
      if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new AggregateError([error, cleanupError], `Could not save FLUX configuration at "${path}".`);
      }
    }
    throw new Error(`Could not save FLUX configuration at "${path}".`, { cause: error });
  }
}

function parseConfig(input: unknown, path: string): Partial<FluxConfig> {
  const invalid = (detail: string): never => {
    throw new Error(`Invalid FLUX configuration at "${path}": ${detail}. Run "flux setup" to repair it.`);
  };
  const record = isRecord(input) ? input : invalid("expected a JSON object");
  if (record.defaultProvider !== undefined && !isProviderName(record.defaultProvider)) {
    invalid("defaultProvider must be ollama, openai-compatible, or bharatcode");
  }
  if (record.defaultModel !== undefined && typeof record.defaultModel !== "string") {
    invalid("defaultModel must be a string");
  }
  if (record.providers !== undefined && !isRecord(record.providers)) invalid("providers must be an object");
  const providers = record.providers;
  if (isRecord(providers)) {
    for (const name of Object.keys(providers)) {
      if (!isProviderName(name)) continue;
      const provider = providers[name];
      const providerRecord = isRecord(provider) ? provider : invalid(`providers.${name} must be an object`);
      if (providerRecord.model !== undefined && typeof providerRecord.model !== "string") invalid(`providers.${name}.model must be a string`);
      if (providerRecord.baseUrl !== undefined && typeof providerRecord.baseUrl !== "string") invalid(`providers.${name}.baseUrl must be a string`);
      if (typeof providerRecord.baseUrl === "string" && containsUrlCredentials(providerRecord.baseUrl)) {
        invalid(`providers.${name}.baseUrl must not contain credentials, query parameters, or fragments; use credentialEnv instead`);
      }
      if (providerRecord.enabled !== undefined && typeof providerRecord.enabled !== "boolean") invalid(`providers.${name}.enabled must be a boolean`);
      if (providerRecord.apiKey !== undefined && typeof providerRecord.apiKey !== "string") invalid(`providers.${name}.apiKey must be a string`);
      if (providerRecord.credentialEnv !== undefined && typeof providerRecord.credentialEnv !== "string") invalid(`providers.${name}.credentialEnv must be a string`);
      if (providerRecord.displayName !== undefined && typeof providerRecord.displayName !== "string") invalid(`providers.${name}.displayName must be a string`);
    }
  }
  return record as Partial<FluxConfig>;
}

function isProviderName(value: unknown): value is ProviderName {
  return value === "ollama" || value === "openai-compatible" || value === "bharatcode";
}

function containsUrlCredentials(value: string): boolean {
  try {
    const url = new URL(value);
    return Boolean(url.username || url.password || url.search || url.hash);
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
