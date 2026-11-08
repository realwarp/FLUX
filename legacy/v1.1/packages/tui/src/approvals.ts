import type { ApprovalDecision, ApprovalHandler, ApprovalRequest } from "@flux/permissions";

/**
 * Bridges the agent loop's async approval request to the TUI. Exactly one
 * request can be pending at a time; the TUI renders it and resolves it.
 */
export class UiApprovalHandler implements ApprovalHandler {
  private pending: { request: ApprovalRequest; resolve: (decision: ApprovalDecision) => void } | undefined;
  private readonly listeners = new Set<(request: ApprovalRequest | undefined) => void>();

  request(request: ApprovalRequest): Promise<ApprovalDecision> {
    return new Promise<ApprovalDecision>((resolve) => {
      this.pending = { request, resolve };
      this.notify();
    });
  }

  decide(decision: ApprovalDecision): void {
    const pending = this.pending;
    this.pending = undefined;
    this.notify();
    pending?.resolve(decision);
  }

  current(): ApprovalRequest | undefined {
    return this.pending?.request;
  }

  subscribe(listener: (request: ApprovalRequest | undefined) => void): () => void {
    this.listeners.add(listener);
    listener(this.pending?.request);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.pending?.request);
      } catch {
        // ignore UI listener errors
      }
    }
  }
}
