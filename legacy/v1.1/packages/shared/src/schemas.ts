import { z } from "zod";
import type { FluxConfig } from "./types.ts";

const capabilityState = z.enum(["supported", "unsupported", "unknown"]);

export const modelCapabilitiesSchema = z.object({
  streaming: capabilityState.default("unknown"),
  toolCalls: capabilityState.default("unknown"),
  structuredOutput: capabilityState.default("unknown"),
  cancellation: capabilityState.default("unknown"),
  usageReporting: capabilityState.default("unknown"),
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  source: z.string().optional(),
  verifiedAt: z.string().optional(),
});

export const modelRefSchema = z.object({
  providerProfileId: z.string().min(1),
  modelId: z.string().min(1),
});

export const providerProfileSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-_]*$/i, "Provider id must be alphanumeric with dashes/underscores"),
  displayName: z.string().min(1),
  protocol: z.literal("openai-compatible").default("openai-compatible"),
  baseURL: z.string().url(),
  credentialRef: z
    .string()
    .regex(/^env:[A-Za-z_][A-Za-z0-9_]*$/, "credentialRef must look like env:VARIABLE_NAME")
    .optional(),
  headers: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().default(true),
  models: z.array(z.string().min(1)).default([]),
  defaultModelId: z.string().min(1).optional(),
  capabilities: z.record(z.string(), modelCapabilitiesSchema).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastTest: z
    .object({ at: z.string(), ok: z.boolean(), message: z.string() })
    .optional(),
});

export const agentRoleSchema = z.enum([
  "main",
  "explore",
  "planner",
  "implementer",
  "reviewer",
  "tester",
]);

export const budgetSchema = z.object({
  sessionTokens: z.number().int().positive().optional(),
  sessionRequests: z.number().int().positive().optional(),
  taskTokens: z.number().int().positive().optional(),
  taskRequests: z.number().int().positive().optional(),
  agentTokens: z.number().int().positive().optional(),
  warnAtRatio: z.number().min(0.1).max(0.99).optional(),
});

export const fallbackSchema = z.object({
  enabled: z.boolean().default(false),
  chain: z.array(modelRefSchema).default([]),
  perRole: z.partialRecord(agentRoleSchema, z.array(modelRefSchema)).optional(),
});

export const configSchema = z.object({
  version: z.literal(1).default(1),
  defaultModel: modelRefSchema.optional(),
  roles: z.partialRecord(agentRoleSchema, modelRefSchema).default({}),
  fallback: fallbackSchema.default({ enabled: false, chain: [] }),
  budgets: budgetSchema.default({}),
  providers: z.array(providerProfileSchema).default([]),
  ui: z
    .object({
      theme: z.enum(["flux", "mono"]).optional(),
      permissionMode: z.enum(["read-only", "ask", "accept-edits"]).optional(),
    })
    .default({}),
});

export function emptyConfig(): FluxConfig {
  return {
    version: 1,
    roles: {},
    fallback: { enabled: false, chain: [] },
    budgets: {},
    providers: [],
    ui: {},
  };
}

export function parseConfig(input: unknown): FluxConfig {
  return configSchema.parse(input) as FluxConfig;
}

/** Validate a value and return a readable, redaction-safe message. */
export function zodMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}
