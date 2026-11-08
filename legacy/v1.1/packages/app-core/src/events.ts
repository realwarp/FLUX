import type { AgentEvent } from "@flux/agent-runtime";
import type { SessionRow } from "@flux/persistence";

export type AppEvent =
  | AgentEvent
  | { type: "session-created"; session: SessionRow }
  | { type: "task-state"; taskId: string; state: string }
  | { type: "turn-error"; message: string };

export class EventBus {
  private readonly listeners = new Set<(event: AppEvent) => void>();

  subscribe(listener: (event: AppEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: AppEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A UI listener must never break the agent loop.
      }
    }
  }
}
