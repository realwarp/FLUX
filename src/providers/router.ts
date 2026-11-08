// Pi-backed provider selection and model routing.
import { createModels, createProvider, type MutableModels } from "@earendil-works/pi-ai/models";
import { stream, streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import type { Model } from "@earendil-works/pi-ai";
import type { ProviderConfig, ProviderName, FluxConfig } from "../config/providers.js";

export interface RoutedModel {
  provider: ProviderName;
  model: Model<"openai-completions" | "openai-responses">;
}

export interface ModelReadiness {
  status: "ready" | "missing" | "unverified" | "disabled" | "unconfigured";
  message?: string;
}

/** Builds Pi's provider registry from FLUX configuration without embedding credentials. */
export function createProviderRegistry(
  config: FluxConfig,
  options: { ollamaModelIds?: readonly string[] } = {},
): MutableModels {
  const models = createModels();
  for (const [name, provider] of Object.entries(config.providers) as [ProviderName, ProviderConfig][]) {
    if (!provider.enabled || (name !== "ollama" && name !== "openai-compatible" && name !== "bharatcode")) continue;
    const modelIds = name === "ollama"
      ? [...new Set([provider.model, ...(options.ollamaModelIds ?? [])])]
      : [provider.model];
    if (!modelIds.some((modelId) => modelId.trim().length > 0)) continue;
    models.setProvider(createProvider({
      id: name,
      name,
      baseUrl: provider.baseUrl,
      models: modelIds.map((model) => makeModel(name, { ...provider, model })),
      auth: {
        apiKey: {
          name: `${name} API key`,
          resolve: async ({ ctx, credential }) => {
            const envPrefix = name === "openai-compatible" ? "OPENAI" : name.toUpperCase();
            const key = credential?.key ??
              provider.apiKey ??
              await ctx.env(provider.credentialEnv ?? `${envPrefix}_API_KEY`);
            if (key) return { auth: { apiKey: key } };
            if (name === "ollama") return { auth: { apiKey: "unused" } };
            return undefined;
          },
        },
      },
      api: { stream, streamSimple },
    }));
  }
  return models;
}

export function getConfiguredModelReadiness(
  config: FluxConfig,
  providerName: ProviderName,
  modelId: string | undefined,
  ollamaModelIds?: readonly string[],
): ModelReadiness {
  const provider = config.providers[providerName];
  if (!provider) {
    return {
      status: "unconfigured",
      message: `Provider "${providerName}" is not configured. Set FLUX_PROVIDER to a configured provider.`,
    };
  }
  if (!provider.enabled) {
    return {
      status: "disabled",
      message: `Provider "${providerName}" is disabled. Enable it in FLUX configuration before starting a session.`,
    };
  }
  if (!modelId) {
    return {
      status: "unconfigured",
      message: `No model is configured for "${providerName}". Set FLUX_MODEL or providers.${providerName}.model.`,
    };
  }
  if (providerName !== "ollama") return { status: "ready" };
  if (ollamaModelIds === undefined) {
    return {
      status: "unverified",
      message: "FLUX could not verify installed Ollama models. Start Ollama or check its configured endpoint; after it is reachable, choose an installed model in the TUI or set FLUX_MODEL for a non-interactive run. FLUX will not silently substitute another model.",
    };
  }
  if (isOllamaModelInstalled(modelId, ollamaModelIds)) return { status: "ready" };
  return {
    status: "missing",
    message: `Configured Ollama model "${modelId}" is not installed. Run "ollama pull ${modelId}", set FLUX_MODEL to an installed model, or use Ctrl+K > Select model in the TUI. FLUX will not silently substitute another model.`,
  };
}

export function describeInferenceRoute(
  config: FluxConfig,
  model: { provider: string; id: string },
  ollamaModelIds?: readonly string[],
): string {
  const providerName = model.provider as ProviderName;
  const provider = config.providers[providerName];
  if (!provider?.enabled) return "The selected provider is not enabled in FLUX configuration; inference is unavailable.";

  let hostname: string;
  try {
    hostname = new URL(provider.baseUrl).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return "The configured provider endpoint is not a valid URL; inference location is unknown.";
  }
  const endpoint = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
    ? "loopback"
    : "non-loopback";

  if (providerName === "ollama") {
    if (ollamaModelIds === undefined) {
      return `Ollama uses a configured ${endpoint} endpoint, but FLUX could not verify its model list or where inference executes.`;
    }
    if (!isOllamaModelInstalled(model.id, ollamaModelIds)) {
      return `Ollama uses a configured ${endpoint} endpoint, but its model list does not include the selected model; inference location is unknown.`;
    }
    return `FLUX confirmed the selected model is listed by Ollama at the configured ${endpoint} endpoint. This does not verify whether Ollama forwards inference elsewhere.`;
  }

  return `The configured ${endpoint} endpoint is used for ${providerName}. FLUX cannot verify where that provider executes inference or whether it forwards requests.`;
}

export async function listOllamaModelIds(config: FluxConfig): Promise<string[] | undefined> {
  const provider = config.providers.ollama;
  if (!provider?.enabled) return undefined;
  try {
    const response = await fetch(new URL("/api/tags", provider.baseUrl), {
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return undefined;
    const result: unknown = await response.json();
    if (!isRecord(result) || !Array.isArray(result.models)) return undefined;
    return result.models.flatMap((model) =>
      isRecord(model) && typeof model.name === "string" ? [model.name] : []);
  } catch {
    return undefined;
  }
}

/** Resolves an explicitly requested provider/model or the configured default. */
export function routeModel(config: FluxConfig, providerName?: string, modelName?: string): RoutedModel {
  const name = (providerName ?? config.defaultProvider ?? "ollama") as ProviderName;
  const provider = config.providers[name];
  if (!provider?.enabled) throw new Error(`Provider "${name}" is not configured or is disabled.`);
  const model = modelName ?? config.defaultModel ?? provider.model;
  return { provider: name, model: makeModel(name, { ...provider, model }) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isOllamaModelInstalled(modelId: string, installedModelIds: readonly string[]): boolean {
  const withLatestTag = (id: string) => id.includes(":") ? id : `${id}:latest`;
  const expected = withLatestTag(modelId);
  return installedModelIds.some((installedModelId) => withLatestTag(installedModelId) === expected);
}

function makeModel(provider: ProviderName, config: ProviderConfig): Model<"openai-completions"> {
  return {
    id: config.model,
    name: config.model,
    api: "openai-completions",
    provider,
    baseUrl: config.baseUrl,
    input: ["text"],
    reasoning: false,
    contextWindow: 128000,
    maxTokens: 4096,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}
