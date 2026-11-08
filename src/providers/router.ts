// Pi-backed provider selection and model routing.
import { createModels, createProvider, type MutableModels } from "@earendil-works/pi-ai/models";
import { stream, streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import type { Model } from "@earendil-works/pi-ai";
import type { ProviderConfig, ProviderName, FluxConfig } from "../config/providers.js";

export interface RoutedModel {
  provider: ProviderName;
  model: Model<"openai-completions" | "openai-responses">;
}

/** Builds Pi's provider registry from FLUX configuration without embedding credentials. */
export function createProviderRegistry(config: FluxConfig): MutableModels {
  const models = createModels();
  for (const [name, provider] of Object.entries(config.providers) as [ProviderName, ProviderConfig][]) {
    if (!provider.enabled || (name !== "ollama" && name !== "openai-compatible" && name !== "bharatcode")) continue;
    models.setProvider(createProvider({
      id: name,
      name,
      baseUrl: provider.baseUrl,
      models: [makeModel(name, provider)],
      auth: {
        apiKey: {
          name: `${name} API key`,
          resolve: async ({ ctx, credential }) => {
            const envPrefix = name === "openai-compatible" ? "OPENAI" : name.toUpperCase();
            const key = credential?.key ?? provider.apiKey ?? await ctx.env(`${envPrefix}_API_KEY`);
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

/** Resolves an explicitly requested provider/model or the configured default. */
export function routeModel(config: FluxConfig, providerName?: string, modelName?: string): RoutedModel {
  const name = (providerName ?? config.defaultProvider ?? "ollama") as ProviderName;
  const provider = config.providers[name];
  if (!provider?.enabled) throw new Error(`Provider "${name}" is not configured or is disabled.`);
  const model = modelName ?? config.defaultModel ?? provider.model;
  return { provider: name, model: makeModel(name, { ...provider, model }) };
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
