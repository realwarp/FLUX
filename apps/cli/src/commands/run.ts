import { FluxError, formatTokens, type AgentRole } from "@flux/shared";
import type { AgentEvent } from "@flux/agent-runtime";
import { approvalsFor, boolFlag, openApp, paint, parseArgs, stringFlag } from "../common.ts";

export async function runCommand(argv: string[]): Promise<void> {
  const { positionals, flags } = parseArgs(argv);
  const prompt = positionals.join(" ").trim();
  if (!prompt) {
    throw new FluxError("config", 'Usage: flux run "<prompt>" [--role main] [--yes] [--read-only] [--json]');
  }
  const json = boolFlag(flags, "json");
  const yes = boolFlag(flags, "yes") || boolFlag(flags, "y");
  const role = (stringFlag(flags, "role") ?? "main") as AgentRole;
  const sessionIdFlag = stringFlag(flags, "session");
  const maxSteps = Number(stringFlag(flags, "max-steps") ?? "") || undefined;
  const permissionMode = boolFlag(flags, "read-only")
    ? "read-only"
    : boolFlag(flags, "accept-edits")
      ? "accept-edits"
      : undefined;

  const app = await openApp({ yes, maxSteps, permissionMode });
  const session = sessionIdFlag ? app.getSession(sessionIdFlag) : app.createSession({ title: prompt.slice(0, 60) });
  const events: AgentEvent[] = [];
  let streamed = false;

  const unsubscribe = app.events.subscribe((event) => {
    if (event.type === "turn-error" || event.type === "session-created" || event.type === "task-state") return;
    events.push(event);
    if (json) return;
    if (event.type === "text") {
      process.stdout.write(event.text);
      streamed = true;
    } else if (event.type === "tool-call") {
      process.stdout.write(
        `\n${paint.cyan(`[tool] ${event.call.name}`)} ${paint.dim(event.call.arguments.slice(0, 160))}\n`,
      );
    } else if (event.type === "tool-result") {
      process.stdout.write(`${event.ok === false ? paint.red("[tool failed]") : paint.dim("[tool done]")} ${event.content.split("\n")[0]?.slice(0, 160) ?? ""}\n`);
    } else if (event.type === "plan") {
      process.stdout.write(`\n${paint.bold("Proposed plan:")} ${event.plan}\n`);
      event.steps.forEach((step, index) => process.stdout.write(`  ${index + 1}. ${step}\n`));
    } else if (event.type === "fallback") {
      process.stdout.write(`\n${paint.yellow(`[fallback] ${event.from} -> ${event.to}: ${event.reason}`)}\n`);
    } else if (event.type === "notice" && event.level !== "info") {
      process.stdout.write(`\n${event.level === "error" ? paint.red(event.message) : paint.yellow(event.message)}\n`);
    }
  });

  const controller = new AbortController();
  const onSignal = (): void => {
    controller.abort();
    process.stdout.write("\nCancelling...\n");
  };
  process.once("SIGINT", onSignal);

  try {
    const outcome = await app.runTurn({
      sessionId: session.id,
      prompt,
      role,
      approvals: approvalsFor(yes && !boolFlag(flags, "read-only")),
      signal: controller.signal,
    });
    const usage = app.usageSummary(session.id);
    const budget = app.sessionBudget(session.id);
    if (!json) {
      if (streamed) process.stdout.write("\n");
      process.stdout.write(
        `\n${paint.dim(
          `session ${session.id} | task ${outcome.taskId} | ${outcome.result.state} | steps ${outcome.result.steps} | tools ${outcome.result.toolCalls} | tokens ${formatTokens(usage.totalTokens)} (${usage.estimatedEvents > 0 ? "partly estimated" : "provider-reported"}) | budget ${budget.level}`,
        )}\n`,
      );
      if (budget.level !== "ok") process.stdout.write(`${paint.yellow(budget.message)}\n`);
    } else {
      process.stdout.write(
        `${JSON.stringify({ sessionId: session.id, taskId: outcome.taskId, result: outcome.result, usage, budget, events }, null, 2)}\n`,
      );
    }
    if (outcome.result.state !== "completed") process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", onSignal);
    unsubscribe();
    app.close();
  }
}
