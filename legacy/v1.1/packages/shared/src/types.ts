/** Shared domain vocabulary for FLUX. */

export type CapabilityState = "supported" | "unsupported" | "unknown";

export interface ModelCapabilities {
  streaming: CapabilityState;
  toolCalls: CapabilityState;
  structuredOutput: CapabilityState;
  cancellation: CapabilityState;
  usageReporting: CapabilityState;
  contextWindow?: number;
  maxOutputTokens?: number;
  source?: string;
  verifiedAt?: string;
}

export interface ProviderProfile {
  id: string;
  displayName: string;
  protocol: "openai-compatible";
  baseURL: string;
  /** Reference such as `env:MY_KEY`. Never the secret itself. */
  credentialRef?: string;
  /** Extra non-secret headers (values may themselves be credential refs). */
  headers?: Record<string, string>;
  enabled: boolean;
  models: string[];
  defaultModelId?: string;
  /** Cached capability snapshots keyed by model id. */
  capabilities?: Record<string, ModelCapabilities>;
  createdAt: string;
  updatedAt: string;
  lastTest?: { at: string; ok: boolean; message: string };
}

export type AgentRole = "main" | "explore" | "planner" | "implementer" | "reviewer" | "tester";

export const AGENT_ROLES: readonly AgentRole[] = [
  "main",
  "explore",
  "planner",
  "implementer",
  "reviewer",
  "tester",
];

export interface ModelRef {
  providerProfileId: string;
  modelId: string;
}

export interface RoleOverride {
  role: AgentRole;
  model: ModelRef;
}

export interface FallbackConfig {
  enabled: boolean;
  chain: ModelRef[];
  perRole?: Partial<Record<AgentRole, ModelRef[]>>;
}

export interface BudgetConfig {
  /** Hard ceilings. `null`/absent means unlimited. */
  sessionTokens?: number;
  sessionRequests?: number;
  taskTokens?: number;
  taskRequests?: number;
  agentTokens?: number;
  /** Ratio (0..1) at which a warning is emitted. Default 0.8. */
  warnAtRatio?: number;
}

export interface FluxUiConfig {
  theme?: "flux" | "mono";
  /** Ask before every write/shell action (default). */
  permissionMode?: PermissionMode;
}

export interface FluxConfig {
  version: 1;
  defaultModel?: ModelRef;
  /** Per-role overrides; a missing entry inherits `defaultModel`. */
  roles: Partial<Record<AgentRole, ModelRef>>;
  fallback: FallbackConfig;
  budgets: BudgetConfig;
  providers: ProviderProfile[];
  ui: FluxUiConfig;
}

export type PermissionMode = "read-only" | "ask" | "accept-edits";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  /** Parsed arguments when valid JSON. */
  parsed?: unknown;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxOutputTokens?: number;
  /** Ask the endpoint for reported usage on streamed responses. */
  includeUsage?: boolean;
  signal?: AbortSignal;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type ModelEvent =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "tool-call"; call: ToolCall }
  | { type: "usage"; usage: TokenUsage }
  | { type: "done"; finishReason: string };

export type UsageSource = "provider-reported" | "estimated";

export interface UsageEvent {
  id: string;
  at: string;
  sessionId: string;
  taskId?: string;
  agentId?: string;
  providerProfileId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requests: number;
  source: UsageSource;
  /** Set when the totals were derived from a conservative heuristic. */
  estimatedFrom?: string;
}

export interface UsageSummary {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reportedEvents: number;
  estimatedEvents: number;
}

export type TaskState =
  | "queued"
  | "planning"
  | "awaiting_approval"
  | "running"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentState =
  | "idle"
  | "working"
  | "awaiting_approval"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

export interface SessionRecord {
  id: string;
  title: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  defaultModel?: ModelRef;
  status: "active" | "completed" | "failed";
}

export interface MessageRecord {
  id: string;
  sessionId: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  agentId?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  interrupted?: boolean;
}

export interface VerificationRecord {
  id: string;
  sessionId: string;
  taskId?: string;
  command: string;
  cwd: string;
  exitCode: number;
  durationMs: number;
  output: string;
  truncated: boolean;
  status: "passed" | "failed" | "skipped" | "inconclusive";
  at: string;
}

export type ErrorCategory =
  | "provider-auth"
  | "quota-exhausted"
  | "rate-limit"
  | "budget-exhausted"
  | "network"
  | "transient"
  | "unsupported-capability"
  | "tool-validation"
  | "permission-denied"
  | "path-denied"
  | "command-timeout"
  | "parse"
  | "persistence"
  | "config"
  | "cancelled"
  | "internal";
