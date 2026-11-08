import { describe, expect, test } from "bun:test";
import { BudgetManager, UsageLedger, estimateTokens } from "@flux/providers";
import { FluxError } from "@flux/shared";

function ledgerWith(
  events: Array<{
    sessionId?: string;
    taskId?: string;
    agentId?: string;
    totalTokens: number;
    source?: "provider-reported" | "estimated";
    requests?: number;
  }>,
): UsageLedger {
  const ledger = new UsageLedger();
  for (const event of events) {
    ledger.record({
      sessionId: event.sessionId ?? "ses_1",
      taskId: event.taskId,
      agentId: event.agentId,
      providerProfileId: "local",
      modelId: "m",
      inputTokens: 0,
      outputTokens: event.totalTokens,
      totalTokens: event.totalTokens,
      requests: event.requests,
      source: event.source ?? "provider-reported",
    });
  }
  return ledger;
}

describe("usage ledger", () => {
  test("labels provider-reported and estimated usage separately", () => {
    const ledger = ledgerWith([
      { totalTokens: 100, source: "provider-reported" },
      { totalTokens: 50, source: "estimated" },
    ]);
    const summary = ledger.summarize({ sessionId: "ses_1" });
    expect(summary.requests).toBe(2);
    expect(summary.totalTokens).toBe(150);
    expect(summary.reportedEvents).toBe(1);
    expect(summary.estimatedEvents).toBe(1);
  });

  test("filters by task and agent scope", () => {
    const ledger = ledgerWith([
      { totalTokens: 100, taskId: "t1", agentId: "a1" },
      { totalTokens: 40, taskId: "t1", agentId: "a2" },
      { totalTokens: 10, taskId: "t2", agentId: "a1" },
    ]);
    expect(ledger.summarize({ sessionId: "ses_1", taskId: "t1" }).totalTokens).toBe(140);
    expect(ledger.summarize({ sessionId: "ses_1", agentId: "a1" }).totalTokens).toBe(110);
  });

  test("estimates tokens conservatively from characters", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("12345678")).toBe(2);
    expect(estimateTokens("x")).toBe(1);
  });
});

describe("budget manager", () => {
  test("warns at the configured ratio and hard-stops when exhausted", () => {
    const ledger = ledgerWith([{ totalTokens: 85 }]);
    const budgets = new BudgetManager({ sessionTokens: 100, warnAtRatio: 0.8 }, ledger);

    const warn = budgets.evaluate({ sessionId: "ses_1" });
    expect(warn.level).toBe("warn");
    expect(warn.message).toContain("85%");

    ledger.record({
      sessionId: "ses_1",
      providerProfileId: "local",
      modelId: "m",
      inputTokens: 15,
      outputTokens: 0,
      totalTokens: 15,
      source: "provider-reported",
    });

    const exhausted = budgets.evaluate({ sessionId: "ses_1" });
    expect(exhausted.level).toBe("exhausted");
    expect(() => budgets.assertCanStart({ sessionId: "ses_1" })).toThrow(FluxError);
  });

  test("enforces task and request budgets", () => {
    const ledger = ledgerWith([
      { totalTokens: 10, taskId: "t1", requests: 2 },
      { totalTokens: 10, taskId: "t2" },
    ]);
    const taskBudgets = new BudgetManager({ taskRequests: 2 }, ledger);
    expect(taskBudgets.evaluate({ sessionId: "ses_1", taskId: "t1" }).level).toBe("exhausted");

    const requestBudgets = new BudgetManager({ sessionRequests: 2 }, ledger);
    expect(requestBudgets.evaluate({ sessionId: "ses_1" }).level).toBe("exhausted");
  });

  test("reports estimated usage and leaves unconfigured budgets open", () => {
    const ledger = ledgerWith([{ totalTokens: 500, source: "estimated" }]);
    const budgets = new BudgetManager({}, ledger);
    const status = budgets.evaluate({ sessionId: "ses_1" });
    expect(status.level).toBe("ok");
    expect(status.estimated).toBe(true);
  });
});
