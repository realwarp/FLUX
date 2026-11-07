import type { AgentRole, AgentState, ModelEvent, TokenUsage, ToolCall, ToolDefinition } from "@flux/shared";

export interface DelegationRequest {
  role: AgentRole;
  prompt: string;
}

export type AgentEvent =
  | { type: "agent-start"; agentId: string; role: AgentRole; provider: string; model: string }
  | { type: "text"; agentId: string; text: string }
  | { type: "reasoning"; agentId: string; text: string }
  | { type: "tool-call"; agentId: string; call: ToolCall }
  | { type: "tool-result"; agentId: string; call: ToolCall; ok: boolean; content: string }
  | { type: "plan"; agentId: string; plan: string; steps: string[] }
  | { type: "fallback"; from: string; to: string; reason: string }
  | { type: "usage"; agentId: string; source: "provider-reported" | "estimated"; usage: TokenUsage }
  | {
      type: "verification";
      agentId: string;
      command: string;
      cwd: string;
      exitCode: number;
      durationMs: number;
      status: "passed" | "failed";
    }
  | { type: "notice"; level: "info" | "warn" | "error"; message: string }
  | { type: "agent-state"; agentId: string; role: AgentRole; state: AgentState }
  | { type: "agent-done"; agentId: string; role: AgentRole; text: string; state: "completed" | "failed" | "cancelled" };

export interface AgentRunResult {
  text: string;
  state: "completed" | "failed" | "cancelled";
  steps: number;
  toolCalls: number;
}

export interface SubagentRunner {
  run(request: DelegationRequest, parentAgentId: string): Promise<AgentRunResult>;
}

export type { ModelEvent, ToolDefinition };
