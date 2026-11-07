import {
  FluxError,
  type AgentRole,
  type FluxConfig,
  type ModelCapabilities,
  type ModelRef,
  type ProviderProfile,
} from "@flux/shared";

export interface ModelTarget {
  providerProfileId: string;
  modelId: string;
  profile: ProviderProfile;
  capabilities: ModelCapabilities;
  source: "role-override" | "default";
}

export const UNKNOWN_CAPABILITIES: ModelCapabilities = {
  streaming: "unknown",
  toolCalls: "unknown",
  structuredOutput: "unknown",
  cancellation: "unknown",
  usageReporting: "unknown",
};

/** Resolves a role into a concrete provider/model target. */
export class ModelRouter {
  constructor(private readonly config: FluxConfig) {}

  resolve(role: AgentRole): ModelTarget {
    const override = this.config.roles[role];
    const ref = override ?? this.config.defaultModel;
    if (!ref) {
      throw new FluxError(
        "config",
        "No model is configured. Run `flux auth` (or `flux providers add`) and choose a default model.",
      );
    }
    return this.toTarget(ref, override ? "role-override" : "default");
  }

  resolveRef(ref: ModelRef): ModelTarget {
    return this.toTarget(ref, "default");
  }

  fallbackChain(role: AgentRole): ModelTarget[] {
    if (!this.config.fallback.enabled) return [];
    const perRole = this.config.fallback.perRole?.[role];
    const chain = perRole && perRole.length > 0 ? perRole : this.config.fallback.chain;
    return chain
      .filter((ref) => !this.isSameRef(ref, this.config.roles[role] ?? this.config.defaultModel))
      .map((ref) => this.toTarget(ref, "default"));
  }

  private isSameRef(a: ModelRef, b: ModelRef | undefined): boolean {
    return Boolean(b && a.providerProfileId === b.providerProfileId && a.modelId === b.modelId);
  }

  private toTarget(ref: ModelRef, source: ModelTarget["source"]): ModelTarget {
    const profile = this.config.providers.find((candidate) => candidate.id === ref.providerProfileId);
    if (!profile) {
      throw new FluxError("config", `Model target references unknown provider profile: ${ref.providerProfileId}`);
    }
    if (!profile.enabled) {
      throw new FluxError("config", `Provider profile is disabled: ${profile.displayName}`);
    }
    const capabilities = profile.capabilities?.[ref.modelId] ?? UNKNOWN_CAPABILITIES;
    return {
      providerProfileId: profile.id,
      modelId: ref.modelId,
      profile,
      capabilities,
      source,
    };
  }
}

export function describeTarget(target: ModelTarget): string {
  return `${target.profile.displayName} / ${target.modelId}`;
}

export function toolsAllowed(target: ModelTarget): boolean {
  return target.capabilities.toolCalls !== "unsupported";
}
