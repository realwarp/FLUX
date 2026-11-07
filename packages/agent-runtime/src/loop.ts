import {
  FluxError,
  classifyHttpError,
  describeError,
  newId,
  nowIso,
  type AgentRole,
  type ChatMessage,
  type ToolCall,
  type TokenUsage,
} from "@flux/shared";
import {
  BudgetManager,
  UsageLedger,
  describeTarget,
  estimateTokens,
  streamWithFallback,
  type ModelProvider,
  type ModelRouter,
  type ModelTarget,
} from "@flux/providers";
import { READ_ONLY_TOOLS, type ToolContext, type ToolExecutor, type ToolResult } from "@flux/tools";
import type { ApprovalHandler } from "@flux/permissions";
import type { FluxDatabase } from "@flux/persistence";
import type { RepositoryContext } from "@flux/repository";
import type { AgentEvent, AgentRunResult } from "./types.ts";
import { buildSystemPrompt } from "./prompts.ts";

export interface AgentRunnerDeps {
  router: ModelRouter;
  providerFor: (target: ModelTarget) => ModelProvider;
  tools: ToolExecutor;
  toolContext: ToolContext;
  ledger: UsageLedger;
  budgets: BudgetManager;
  approvals: ApprovalHandler;
  db?: FluxDatabase;
  repo: RepositoryContext;
  fallbackEnabled: boolean;
  emit: (event: AgentEvent) => void;
  maxSteps?: number;
  maxPromptChars?: number;
  delegation?: (
    input: { role: AgentRole; prompt: string; sessionId: string; taskId?: string; history: ChatMessage[]; depth: number },
    parentAgentId: string,
  ) => Promise<AgentRunResult>;
}

export interface AgentRunInput {
  role: AgentRole;
  prompt: string;
  sessionId: string;
  history?: ChatMessage[];
  taskId?: string;
  agentId?: string;
  depth?: number;
  signal?: AbortSignal;
}

const ROLE_TOOLS: Record<AgentRole, (name: string) => boolean> = {
  main: () => true,
  explore: (name) => READ_ONLY_TOOLS.has(name),
  planner: (name) => READ_ONLY_TOOLS.has(name),
  reviewer: (name) => READ_ONLY_TOOLS.has(name),
  tester: (name) => READ_ONLY_TOOLS.has(name) || name === "run_command",
  implementer: (name) => name !== "delegate_task",
};

const DELEGATE_TOOL = {
  name: "delegate_task",
  description:
    "Delegate a bounded read-only investigation or review to a specialist agent and receive a structured summary. Roles: explore, planner, reviewer, tester.",
  parameters: {
    type: "object",
    properties: {
      role: { type: "string", enum: ["explore", "planner", "reviewer", "tester"] },
      prompt: { type: "string", description: "Specific, self-contained task for the specialist." },
    },
    required: ["role", "prompt"],
  },
};

export async function runAgent(deps: AgentRunnerDeps, input: AgentRunInput): Promise<AgentRunResult> {
  const agentId = input.agentId ?? newId("agent");
  const depth = input.depth ?? 0;
  const maxSteps = deps.maxSteps ?? (input.role === "main" ? 12 : 6);
  const maxPromptChars = deps.maxPromptChars ?? 120_000;
  const emitted = new Set<string>();
  let toolCallCount = 0;
  let steps = 0;
  let lastText = "";

  const allowed = ROLE_TOOLS[input.role];
  const history = trimHistory([...(input.history ?? [])], maxPromptChars);

  let target: ModelTarget;
  try {
    target = deps.router.resolve(input.role);
  } catch (error) {
    deps.emit({ type: "agent-done", agentId, role: input.role, text: describeError(error), state: "failed" });
    throw error;
  }

  const toolsUsable = target.capabilities.toolCalls !== "unsupported";
  if (!toolsUsable) {
    deps.emit({
      type: "notice",
      level: "warn",
      message: `Tool calling is marked unsupported for ${describeTarget(target)}. Running without tools.`,
    });
  }
  const definitions = toolsUsable
    ? deps.tools.definitions((name) => allowed(name) || (name === "delegate_task" && input.role === "main"))
    : [];
  if (input.role === "main" && toolsUsable && depth < 1) definitions.push(DELEGATE_TOOL);

  const systemPrompt = buildSystemPrompt({
    role: input.role,
    workspaceRoot: deps.repo.root,
    isGit: deps.repo.isGit,
    repoSummary: await deps.repo.summary(20),
    toolNames: definitions.map((definition) => definition.name),
    permissionMode: deps.toolContext.policy.mode,
  });

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: input.prompt },
  ];

  deps.emit({ type: "agent-start", agentId, role: input.role, provider: target.profile.displayName, model: target.modelId });
  deps.emit({ type: "agent-state", agentId, role: input.role, state: "working" });

  try {
    while (steps < maxSteps) {
      if (input.signal?.aborted) throw new FluxError("cancelled", "Cancelled by user.");
      steps += 1;

      const budget = deps.budgets.assertCanStart({
        sessionId: input.sessionId,
        taskId: input.taskId,
        agentId,
      });
      if (budget.level === "warn") {
        deps.emit({ type: "notice", level: "warn", message: budget.message });
      }

      let text = "";
      let reasoning = "";
      const calls: ToolCall[] = [];
      let reportedUsage: TokenUsage | undefined;
      const activeTarget = deps.router.resolve(input.role);
      const fallbacks = deps.router.fallbackChain(input.role);

      try {
        for await (const routed of streamWithFallback({
          primary: activeTarget,
          fallbacks,
          request: {
            model: activeTarget.modelId,
            messages: trimHistory(messages, maxPromptChars),
            tools: definitions,
            signal: input.signal,
            temperature: input.role === "tester" ? 0 : 0.2,
          },
          providerFor: deps.providerFor,
          enabled: deps.fallbackEnabled,
        })) {
          if (routed.type === "fallback") {
            deps.emit({
              type: "fallback",
              from: describeTarget(routed.from),
              to: describeTarget(routed.to),
              reason: routed.reason,
            });
            deps.emit({
              type: "notice",
              level: "warn",
              message: `Provider fallback: ${describeTarget(routed.from)} failed (${routed.category}). Continuing on ${describeTarget(routed.to)}.`,
            });
            continue;
          }
          if (routed.type === "provider-start") continue;
          const event = routed.event;
          if (event.type === "text-delta") {
            text += event.text;
            deps.emit({ type: "text", agentId, text: event.text });
          } else if (event.type === "reasoning-delta") {
            reasoning += event.text;
            deps.emit({ type: "reasoning", agentId, text: event.text });
          } else if (event.type === "tool-call") {
            calls.push(event.call);
            deps.emit({ type: "tool-call", agentId, call: event.call });
          } else if (event.type === "usage") {
            reportedUsage = event.usage;
          }
        }
      } catch (error) {
        if (text) {
          deps.db?.appendMessage({ sessionId: input.sessionId, role: "assistant", content: text, agentId, interrupted: true });
        }
        throw error;
      }

      lastText = text;
      const activeForUsage = activeTarget;
      recordUsage(deps, {
        sessionId: input.sessionId,
        taskId: input.taskId,
        agentId,
        target: activeForUsage,
        messages,
        outputText: text + reasoning,
        reported: reportedUsage,
      });

      if (text || reasoning || calls.length > 0) {
        deps.db?.appendMessage({
          sessionId: input.sessionId,
          role: "assistant",
          content: text,
          agentId,
          toolCalls: calls.length > 0 ? calls : undefined,
        });
        messages.push({
          role: "assistant",
          content: text,
          ...(calls.length > 0 ? { toolCalls: calls } : {}),
        });
      }

      if (calls.length === 0) {
        deps.emit({ type: "agent-state", agentId, role: input.role, state: "completed" });
        deps.emit({ type: "agent-done", agentId, role: input.role, text, state: "completed" });
        return { text, state: "completed", steps, toolCalls: toolCallCount };
      }

      for (const call of calls) {
        if (input.signal?.aborted) throw new FluxError("cancelled", "Cancelled by user.");
        toolCallCount += 1;
        const outcome = await handleToolCall(deps, {
          call,
          agentId,
          role: input.role,
          sessionId: input.sessionId,
          taskId: input.taskId,
          depth,
          emitted,
          signal: input.signal,
        });

        if (outcome.stop) {
          deps.emit({ type: "agent-state", agentId, role: input.role, state: "cancelled" });
          deps.emit({ type: "agent-done", agentId, role: input.role, text: outcome.result.content, state: "cancelled" });
          return { text: outcome.result.content, state: "cancelled", steps, toolCalls: toolCallCount };
        }

        deps.emit({
          type: "tool-result",
          agentId,
          call,
          ok: outcome.result.ok,
          content: outcome.result.content,
        });
        recordVerification(deps, {
          agentId,
          sessionId: input.sessionId,
          taskId: input.taskId,
          call,
          result: outcome.result,
        });
        messages.push({
          role: "tool",
          content: outcome.result.content,
          toolCallId: call.id,
          name: call.name,
        });
        deps.db?.appendMessage({
          sessionId: input.sessionId,
          role: "tool",
          content: outcome.result.content,
          agentId,
          toolCallId: call.id,
        });
      }
    }

    deps.emit({
      type: "notice",
      level: "warn",
      message: `Step limit (${maxSteps}) reached without a final answer.`,
    });
    deps.emit({ type: "agent-state", agentId, role: input.role, state: "completed" });
    deps.emit({ type: "agent-done", agentId, role: input.role, text: lastText, state: "completed" });
    return { text: lastText, state: "completed", steps, toolCalls: toolCallCount };
  } catch (error) {
    const state = error instanceof FluxError && error.category === "cancelled" ? "cancelled" : "failed";
    deps.emit({ type: "notice", level: "error", message: describeError(error) });
    deps.emit({ type: "agent-state", agentId, role: input.role, state });
    deps.emit({ type: "agent-done", agentId, role: input.role, text: lastText, state });
    if (state === "cancelled") return { text: lastText, state, steps, toolCalls: toolCallCount };
    throw error;
  }
}

async function handleToolCall(
  deps: AgentRunnerDeps,
  input: {
    call: ToolCall;
    agentId: string;
    role: AgentRole;
    sessionId: string;
    taskId?: string;
    depth: number;
    emitted: Set<string>;
    signal?: AbortSignal;
  },
): Promise<{ stop: boolean; result: ToolResult }> {
  const { call } = input;
  const existing = deps.db?.getToolCall(call.id);
  if (existing?.executed) {
    return { stop: false, result: { ok: existing.ok ?? false, content: existing.result ?? "" } };
  }
  if (input.emitted.has(call.id)) {
    return { stop: false, result: { ok: false, content: "Duplicate tool call suppressed by FLUX." } };
  }
  input.emitted.add(call.id);
  deps.db?.beginToolCall({
    id: call.id,
    sessionId: input.sessionId,
    taskId: input.taskId,
    agentId: input.agentId,
    name: call.name,
    args: call.arguments,
  });

  let result: ToolResult;
  if (call.name === "propose_plan") {
    result = await handlePlan(deps, input);
  } else if (call.name === "delegate_task") {
    result = await handleDelegation(deps, input);
  } else {
    const parsed = call.parsed ?? safeParse(call.arguments);
    result = await deps.tools.execute(call.name, parsed, {
      ...deps.toolContext,
      signal: input.signal,
    });
  }

  deps.db?.finishToolCall(call.id, result.ok, result.content);
  return { stop: false, result };
}

async function handlePlan(
  deps: AgentRunnerDeps,
  input: { call: ToolCall; agentId: string; sessionId: string; taskId?: string },
): Promise<ToolResult> {
  const parsed = (input.call.parsed ?? safeParse(input.call.arguments)) as
    | { plan?: string; steps?: string[] }
    | undefined;
  const plan = parsed?.plan ?? input.call.arguments;
  const steps = parsed?.steps ?? [];
  deps.emit({ type: "plan", agentId: input.agentId, plan, steps });

  const decision = await deps.approvals.request({
    id: `plan-${input.call.id}`,
    title: "Approve plan",
    detail: "FLUX will make changes only after this plan is approved.",
    kind: "plan",
    subject: plan,
  });
  deps.db?.recordApproval({
    id: `plan-${input.call.id}`,
    sessionId: input.sessionId,
    taskId: input.taskId,
    kind: "plan",
    subject: plan.slice(0, 2000),
    decision,
  });

  if (decision === "rejected") {
    return { ok: false, content: "The user rejected the plan. Stop and ask for revised instructions." };
  }
  return {
    ok: true,
    content: `Plan approved by the user. Proceed with the approved steps.\n${plan}${
      steps.length ? `\n${steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}` : ""
    }`,
  };
}

async function handleDelegation(
  deps: AgentRunnerDeps,
  input: { call: ToolCall; agentId: string; sessionId: string; taskId?: string; depth: number },
): Promise<ToolResult> {
  if (!deps.delegation) return { ok: false, content: "Delegation is not available in this session." };
  if (input.depth >= 1) return { ok: false, content: "Nested delegation is not allowed." };
  const parsed = (input.call.parsed ?? safeParse(input.call.arguments)) as
    | { role?: string; prompt?: string }
    | undefined;
  const role = parsed?.role;
  const prompt = parsed?.prompt;
  const allowedRoles: AgentRole[] = ["explore", "planner", "reviewer", "tester"];
  if (!role || !allowedRoles.includes(role as AgentRole)) {
    return { ok: false, content: `delegate_task requires role one of: ${allowedRoles.join(", ")}` };
  }
  if (!prompt || prompt.trim().length < 5) {
    return { ok: false, content: "delegate_task requires a specific prompt." };
  }

  const child = await deps.delegation(
    {
      role: role as AgentRole,
      prompt,
      sessionId: input.sessionId,
      taskId: input.taskId,
      history: [],
      depth: input.depth + 1,
    },
    input.agentId,
  );
  return {
    ok: child.state === "completed",
    content: `Subagent ${role} finished with state=${child.state}, steps=${child.steps}:\n${child.text}`,
    meta: { role, state: child.state },
  };
}

/** Persist command outcomes as verification evidence and surface them to the UI. */
function recordVerification(
  deps: AgentRunnerDeps,
  input: {
    agentId: string;
    sessionId: string;
    taskId?: string;
    call: ToolCall;
    result: ToolResult;
  },
): void {
  if (input.call.name !== "run_command") return;
  const meta = input.result.meta ?? {};
  const exitCode = typeof meta.exitCode === "number" ? meta.exitCode : input.result.ok ? 0 : 1;
  const durationMs = typeof meta.durationMs === "number" ? meta.durationMs : 0;
  const command = typeof meta.command === "string" ? meta.command : input.call.arguments;
  const cwd = typeof meta.cwd === "string" ? meta.cwd : deps.repo.root;
  const truncated = Boolean(meta.truncated) || input.result.content.includes("output-truncated");
  const status: "passed" | "failed" = exitCode === 0 && !meta.timedOut ? "passed" : "failed";

  deps.db?.recordVerification({
    id: newId("verification"),
    sessionId: input.sessionId,
    taskId: input.taskId,
    command,
    cwd,
    exitCode,
    durationMs,
    output: input.result.content.slice(0, 8000),
    truncated,
    status,
    at: nowIso(),
  });
  deps.emit({
    type: "verification",
    agentId: input.agentId,
    command,
    cwd,
    exitCode,
    durationMs,
    status,
  });
}

function recordUsage(
  deps: AgentRunnerDeps,
  input: {
    sessionId: string;
    taskId?: string;
    agentId: string;
    target: ModelTarget;
    messages: ChatMessage[];
    outputText: string;
    reported?: TokenUsage;
  },
): void {
  const reportedTotal = input.reported?.totalTokens ?? 0;
  if (input.reported && reportedTotal > 0) {
    const event = deps.ledger.record({
      sessionId: input.sessionId,
      taskId: input.taskId,
      agentId: input.agentId,
      providerProfileId: input.target.providerProfileId,
      modelId: input.target.modelId,
      inputTokens: input.reported.inputTokens ?? 0,
      outputTokens: input.reported.outputTokens ?? 0,
      totalTokens: reportedTotal,
      source: "provider-reported",
    });
    deps.db?.recordUsage(event);
    deps.emit({
      type: "usage",
      agentId: input.agentId,
      source: "provider-reported",
      usage: input.reported,
    });
    return;
  }

  const promptChars = input.messages.reduce((total, message) => total + message.content.length, 0);
  const event = deps.ledger.record({
    sessionId: input.sessionId,
    taskId: input.taskId,
    agentId: input.agentId,
    providerProfileId: input.target.providerProfileId,
    modelId: input.target.modelId,
    inputTokens: estimateTokensOfChars(promptChars),
    outputTokens: estimateTokens(input.outputText),
    source: "estimated",
    estimatedFrom: "char/4 heuristic (provider did not report usage)",
  });
  deps.db?.recordUsage(event);
  deps.emit({
    type: "usage",
    agentId: input.agentId,
    source: "estimated",
    usage: { inputTokens: event.inputTokens, outputTokens: event.outputTokens, totalTokens: event.totalTokens },
  });
}

function estimateTokensOfChars(chars: number): number {
  return Math.max(1, Math.ceil(chars / 4));
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

/** Keep the newest messages that fit the budget; never drop the system prompt. */
export function trimHistory(messages: ChatMessage[], maxChars: number): ChatMessage[] {
  const total = messages.reduce((sum, message) => sum + message.content.length, 0);
  if (total <= maxChars) return messages;
  const system = messages.filter((message) => message.role === "system");
  const rest = messages.filter((message) => message.role !== "system");
  let used = system.reduce((sum, message) => sum + message.content.length, 0);
  const kept: ChatMessage[] = [];
  for (let index = rest.length - 1; index >= 0; index -= 1) {
    const message = rest[index]!;
    if (used + message.content.length > maxChars) break;
    used += message.content.length;
    kept.unshift(message);
  }
  return [...system, ...kept];
}

export { classifyHttpError };
