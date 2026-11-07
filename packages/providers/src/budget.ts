import { FluxError, type BudgetConfig } from "@flux/shared";
import type { UsageLedger } from "./usage.ts";

export interface BudgetScope {
  sessionId: string;
  taskId?: string;
  agentId?: string;
}

export interface BudgetUsage {
  sessionTokens: number;
  sessionRequests: number;
  taskTokens: number;
  taskRequests: number;
  agentTokens: number;
}

export type BudgetLevel = "ok" | "warn" | "exhausted";

export interface BudgetStatus {
  level: BudgetLevel;
  message: string;
  used: BudgetUsage;
  limits: BudgetConfig;
  /** True when any contributing usage was estimated rather than reported. */
  estimated: boolean;
}

/** Evaluates configured budgets against the usage ledger. */
export class BudgetManager {
  constructor(
    private readonly budgets: BudgetConfig,
    private readonly ledger: UsageLedger,
  ) {}

  usageFor(scope: BudgetScope): BudgetUsage {
    const session = this.ledger.summarize({ sessionId: scope.sessionId });
    const task = scope.taskId ? this.ledger.summarize({ sessionId: scope.sessionId, taskId: scope.taskId }) : undefined;
    const agent = scope.agentId
      ? this.ledger.summarize({ sessionId: scope.sessionId, agentId: scope.agentId })
      : undefined;
    return {
      sessionTokens: session.totalTokens,
      sessionRequests: session.requests,
      taskTokens: task?.totalTokens ?? 0,
      taskRequests: task?.requests ?? 0,
      agentTokens: agent?.totalTokens ?? 0,
    };
  }

  evaluate(scope: BudgetScope): BudgetStatus {
    const used = this.usageFor(scope);
    const warnAt = this.budgets.warnAtRatio ?? 0.8;
    const checks: Array<{ label: string; used: number; limit?: number; kind: "token" | "request" }> = [
      { label: "session tokens", used: used.sessionTokens, limit: this.budgets.sessionTokens, kind: "token" },
      { label: "session requests", used: used.sessionRequests, limit: this.budgets.sessionRequests, kind: "request" },
      { label: "task tokens", used: used.taskTokens, limit: this.budgets.taskTokens, kind: "token" },
      { label: "task requests", used: used.taskRequests, limit: this.budgets.taskRequests, kind: "request" },
      { label: "agent tokens", used: used.agentTokens, limit: this.budgets.agentTokens, kind: "token" },
    ];

    let level: BudgetLevel = "ok";
    let message = "within budget";
    for (const check of checks) {
      if (!check.limit) continue;
      const ratio = check.used / check.limit;
      if (ratio >= 1) {
        level = "exhausted";
        message = `${check.label} budget exhausted (${check.used}/${check.limit})`;
        break;
      }
      if (ratio >= warnAt && level === "ok") {
        level = "warn";
        message = `${check.label} budget at ${Math.round(ratio * 100)}% (${check.used}/${check.limit})`;
      }
    }
    const estimated = this.ledger.summarize({ sessionId: scope.sessionId }).estimatedEvents > 0;
    return { level, message, used, limits: this.budgets, estimated };
  }

  assertCanStart(scope: BudgetScope): BudgetStatus {
    const status = this.evaluate(scope);
    if (status.level === "exhausted") {
      throw new FluxError("budget-exhausted", `${status.message}. Raise the budget or start a new session.`);
    }
    return status;
  }
}
