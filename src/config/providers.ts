// Provider configuration loaded from environment and a local JSON file.
import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

export type ProviderName = "ollama" | "openai-compatible" | "bharatcode";

export interface ProviderConfig {
  name: ProviderName;
  model: string;
  baseUrl: string;
  apiKey?: string;
  enabled: boolean;
}

export interface FluxConfig {
  providers: Partial<Record<ProviderName, ProviderConfig>>;
  defaultProvider?: ProviderName;
  defaultModel?: string;
}

const defaults: Record<ProviderName, Omit<ProviderConfig, "name">> = {
  ollama: { model: "llama3.2", baseUrl: "http://127.0.0.1:11434/v1", enabled: true },
  "openai-compatible": { model: "gpt-4o-mini", baseUrl: "https://api.openai.com/v1", enabled: true },
  bharatcode: { model: "bharatcode", baseUrl: "https://api.bharatgen.ai/v1", enabled: true },
};

/** Loads FLUX provider settings, with environment values taking precedence. */
export async function loadConfig(path = defaultConfigPath()): Promise<FluxConfig> {
  let fileConfig: Partial<FluxConfig> = {};
  try {
    fileConfig = JSON.parse(await readFile(path, "utf8")) as Partial<FluxConfig>;
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
        apiKey: process.env[`${prefix}_API_KEY`] ?? configured?.apiKey,
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
  return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "FLUX", "config.json");
}
