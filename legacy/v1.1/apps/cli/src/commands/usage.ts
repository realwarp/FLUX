import { formatTokens } from "@flux/shared";
import { boolFlag, openApp, paint, parseArgs, stringFlag, table } from "../common.ts";

export async function usageCommand(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const json = boolFlag(flags, "json");
  const sessionId = stringFlag(flags, "session");
  const app = await openApp();
  try {
    const summary = app.usageSummary(sessionId);
    const groups = app.usageByProvider();
    const budget = sessionId ? app.sessionBudget(sessionId) : undefined;

    if (json) {
      process.stdout.write(`${JSON.stringify({ summary, groups, budget: budget ?? null }, null, 2)}\n`);
      return;
    }

    process.stdout.write(`${paint.bold("FLUX usage")}${sessionId ? paint.dim(` — session ${sessionId}`) : ""}\n\n`);
    const rows = [["PROVIDER", "MODEL", "REQUESTS", "INPUT", "OUTPUT", "TOTAL", "SOURCE"]];
    for (const group of groups) {
      rows.push([
        group.providerProfileId,
        group.modelId,
        String(group.summary.requests),
        formatTokens(group.summary.inputTokens),
        formatTokens(group.summary.outputTokens),
        formatTokens(group.summary.totalTokens),
        group.summary.estimatedEvents > 0 && group.summary.reportedEvents > 0
          ? "mixed"
          : group.summary.estimatedEvents > 0
            ? "estimated"
            : "provider",
      ]);
    }
    if (rows.length === 1) {
      process.stdout.write("No usage recorded yet.\n");
    } else {
      process.stdout.write(`${table(rows)}\n`);
    }
    process.stdout.write(
      `\nTotal requests: ${summary.requests} | tokens: ${formatTokens(summary.totalTokens)} ` +
        `(${summary.reportedEvents} reported, ${summary.estimatedEvents} estimated)\n`,
    );
    if (summary.estimatedEvents > 0) {
      process.stdout.write(paint.yellow("Estimated = char/4 heuristic; not an exact token count.\n"));
    }
    if (budget) {
      const levelColor = budget.level === "ok" ? paint.green : budget.level === "warn" ? paint.yellow : paint.red;
      process.stdout.write(
        `Budget: ${levelColor(budget.level)} — ${budget.message}\n` +
          `  session tokens ${formatTokens(budget.used.sessionTokens)}/${budget.limits.sessionTokens ?? "unlimited"} | ` +
          `requests ${budget.used.sessionRequests}/${budget.limits.sessionRequests ?? "unlimited"}\n`,
      );
    }
    process.stdout.write(paint.dim("Provider quota/reset data is shown only when the provider reports it; FLUX never infers it.\n"));
  } finally {
    app.close();
  }
}
