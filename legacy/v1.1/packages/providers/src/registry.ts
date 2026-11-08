import {
  FluxError,
  nowIso,
  newId,
  type AgentRole,
  type FluxConfig,
  type ModelCapabilities,
  type ModelRef,
  type ProviderProfile,
} from "@flux/shared";

function normalizeBaseURL(value: string): string {
  return value.replace(/\/+$/, "");
}

/** CRUD facade over provider profile metadata stored in user config. */
export class ProviderRegistry {
  constructor(
    private config: FluxConfig,
    private readonly onChange?: (config: FluxConfig) => void,
  ) {}

  list(): ProviderProfile[] {
    return this.config.providers;
  }

  enabled(): ProviderProfile[] {
    return this.config.providers.filter((profile) => profile.enabled);
  }

  get(id: string): ProviderProfile {
    const profile = this.config.providers.find((candidate) => candidate.id === id);
    if (!profile) throw new FluxError("config", `Unknown provider profile: ${id}`);
    return profile;
  }

  find(id: string): ProviderProfile | undefined {
    return this.config.providers.find((candidate) => candidate.id === id);
  }

  upsert(input: Omit<ProviderProfile, "createdAt" | "updatedAt"> & Partial<Pick<ProviderProfile, "createdAt">>): ProviderProfile {
    const baseURL = normalizeBaseURL(input.baseURL);
    const existing = this.find(input.id);
    const profile: ProviderProfile = {
      ...input,
      baseURL,
      createdAt: existing?.createdAt ?? input.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    };
    if (existing) {
      const index = this.config.providers.findIndex((candidate) => candidate.id === input.id);
      this.config.providers[index] = profile;
    } else {
      this.config.providers.push(profile);
    }
    this.onChange?.(this.config);
    return profile;
  }

  remove(id: string): void {
    if (this.config.defaultModel?.providerProfileId === id) {
      throw new FluxError("config", "Cannot remove the provider that is the current default model. Choose another default first.");
    }
    this.config.providers = this.config.providers.filter((profile) => profile.id !== id);
    this.onChange?.(this.config);
  }

  setEnabled(id: string, enabled: boolean): ProviderProfile {
    const profile = this.get(id);
    profile.enabled = enabled;
    profile.updatedAt = nowIso();
    this.onChange?.(this.config);
    return profile;
  }

  addModels(id: string, models: string[]): ProviderProfile {
    const profile = this.get(id);
    const merged = new Set([...profile.models, ...models]);
    profile.models = [...merged];
    profile.defaultModelId ??= models[0] ?? profile.models[0];
    profile.updatedAt = nowIso();
    this.onChange?.(this.config);
    return profile;
  }

  setCapabilities(id: string, modelId: string, capabilities: ModelCapabilities): void {
    const profile = this.get(id);
    profile.capabilities = { ...(profile.capabilities ?? {}), [modelId]: capabilities };
    profile.updatedAt = nowIso();
    this.onChange?.(this.config);
  }

  recordTest(id: string, ok: boolean, message: string): void {
    const profile = this.get(id);
    profile.lastTest = { at: nowIso(), ok, message };
    profile.updatedAt = nowIso();
    this.onChange?.(this.config);
  }

  setDefaultModel(ref: ModelRef | undefined): void {
    this.config.defaultModel = ref;
    this.onChange?.(this.config);
  }

  setFallbackEnabled(enabled: boolean): void {
    this.config.fallback = { ...this.config.fallback, enabled };
    this.onChange?.(this.config);
  }

  /** Append a model to the global chain or a role-specific chain. */
  addFallback(ref: ModelRef, role?: AgentRole): void {
    this.get(ref.providerProfileId);
    if (role) {
      const perRole = { ...(this.config.fallback.perRole ?? {}) };
      const chain = [...(perRole[role] ?? [])];
      if (!chain.some((candidate) => sameRef(candidate, ref))) chain.push(ref);
      perRole[role] = chain;
      this.config.fallback = { ...this.config.fallback, perRole };
    } else {
      const chain = [...this.config.fallback.chain];
      if (!chain.some((candidate) => sameRef(candidate, ref))) chain.push(ref);
      this.config.fallback = { ...this.config.fallback, chain };
    }
    this.onChange?.(this.config);
  }

  clearFallback(role?: AgentRole, all = false): void {
    if (all) {
      this.config.fallback = { enabled: false, chain: [] };
    } else if (role) {
      const perRole = { ...(this.config.fallback.perRole ?? {}) };
      delete perRole[role];
      this.config.fallback = { ...this.config.fallback, perRole };
    } else {
      this.config.fallback = { ...this.config.fallback, chain: [] };
    }
    this.onChange?.(this.config);
  }

  setRoleModel(role: string, ref: ModelRef | undefined): void {
    const roles = { ...this.config.roles } as Record<string, ModelRef | undefined>;
    if (ref) roles[role] = ref;
    else delete roles[role];
    this.config.roles = roles as FluxConfig["roles"];
    this.onChange?.(this.config);
  }

  configSnapshot(): FluxConfig {
    return this.config;
  }
}

function sameRef(a: ModelRef, b: ModelRef): boolean {
  return a.providerProfileId === b.providerProfileId && a.modelId === b.modelId;
}

export function createProfile(input: {
  id?: string;
  displayName: string;
  baseURL: string;
  credentialRef?: string;
  models?: string[];
  defaultModelId?: string;
  enabled?: boolean;
  headers?: Record<string, string>;
}): Omit<ProviderProfile, "createdAt" | "updatedAt"> {
  const slug = input.displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const id = input.id ?? (slug || newId("provider"));
  return {
    id,
    displayName: input.displayName,
    protocol: "openai-compatible",
    baseURL: normalizeBaseURL(input.baseURL),
    credentialRef: input.credentialRef,
    headers: input.headers,
    enabled: input.enabled ?? true,
    models: input.models ?? [],
    defaultModelId: input.defaultModelId ?? input.models?.[0],
  };
}
