import { newId, nowIso, type UsageEvent, type UsageSource, type UsageSummary } from "@flux/shared";

export interface UsageQuery {
  sessionId?: string;
  taskId?: string;
  agentId?: string;
  providerProfileId?: string;
  modelId?: string;
}

export interface RecordUsageInput {
  sessionId: string;
  taskId?: string;
  agentId?: string;
  providerProfileId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
  requests?: number;
  source: UsageSource;
  estimatedFrom?: string;
}

/** Conservative ±25% heuristic: ~4 characters per token. Always labelled estimated. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export class UsageLedger {
  private events: UsageEvent[];

  constructor(events: UsageEvent[] = []) {
    this.events = [...events];
  }

  record(input: RecordUsageInput): UsageEvent {
    const inputTokens = Math.max(0, Math.round(input.inputTokens));
    const outputTokens = Math.max(0, Math.round(input.outputTokens));
    const event: UsageEvent = {
      id: newId("usage"),
      at: nowIso(),
      sessionId: input.sessionId,
      taskId: input.taskId,
      agentId: input.agentId,
      providerProfileId: input.providerProfileId,
      modelId: input.modelId,
      inputTokens,
      outputTokens,
      totalTokens: input.totalTokens ?? inputTokens + outputTokens,
      requests: input.requests ?? 1,
      source: input.source,
      estimatedFrom: input.estimatedFrom,
    };
    this.events.push(event);
    return event;
  }

  all(): readonly UsageEvent[] {
    return this.events;
  }

  query(query: UsageQuery = {}): UsageEvent[] {
    return this.events.filter((event) => {
      if (query.sessionId && event.sessionId !== query.sessionId) return false;
      if (query.taskId && event.taskId !== query.taskId) return false;
      if (query.agentId && event.agentId !== query.agentId) return false;
      if (query.providerProfileId && event.providerProfileId !== query.providerProfileId) return false;
      if (query.modelId && event.modelId !== query.modelId) return false;
      return true;
    });
  }

  summarize(query: UsageQuery = {}): UsageSummary {
    const summary: UsageSummary = {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      reportedEvents: 0,
      estimatedEvents: 0,
    };
    for (const event of this.query(query)) {
      summary.requests += event.requests;
      summary.inputTokens += event.inputTokens;
      summary.outputTokens += event.outputTokens;
      summary.totalTokens += event.totalTokens;
      if (event.source === "provider-reported") summary.reportedEvents += 1;
      else summary.estimatedEvents += 1;
    }
    return summary;
  }

  groupByProvider(): Array<{ providerProfileId: string; modelId: string; summary: UsageSummary }> {
    const groups = new Map<string, { providerProfileId: string; modelId: string; summary: UsageSummary }>();
    for (const event of this.events) {
      const key = `${event.providerProfileId}\u0000${event.modelId}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          providerProfileId: event.providerProfileId,
          modelId: event.modelId,
          summary: { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, reportedEvents: 0, estimatedEvents: 0 },
        };
        groups.set(key, group);
      }
      group.summary.requests += event.requests;
      group.summary.inputTokens += event.inputTokens;
      group.summary.outputTokens += event.outputTokens;
      group.summary.totalTokens += event.totalTokens;
      if (event.source === "provider-reported") group.summary.reportedEvents += 1;
      else group.summary.estimatedEvents += 1;
    }
    return [...groups.values()];
  }
}
