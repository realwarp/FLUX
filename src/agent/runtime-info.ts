import type { AgentSession } from "@earendil-works/pi-coding-agent";

export function answerWorkspaceQuestion(prompt: string, cwd: string): string | undefined {
  const query = prompt.trim().replace(/[?.!]+$/, "").replace(/\s+/g, " ").toLocaleLowerCase();
  if (!/^(where is (?:my |the )?current workspace|what is (?:my |the )?current workspace|what(?:'s| is) (?:my |the )?workspace path)$/.test(query)) {
    return undefined;
  }
  return `Current workspace: ${cwd}`;
}

export function appendWorkspaceExchange(session: AgentSession, question: string, answer: string): void {
  const model = session.model;
  if (!model) throw new Error("Cannot persist workspace information without an active model.");

  const timestamp = Date.now();
  session.sessionManager.appendMessage({ role: "user", content: question, timestamp });
  session.sessionManager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: answer }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp,
  });
}
