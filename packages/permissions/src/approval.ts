export interface ApprovalRequest {
  id: string;
  title: string;
  detail: string;
  kind: "write" | "shell" | "plan" | "git" | "external-path";
  /** Exact command or path involved, shown to the user. */
  subject: string;
  diff?: string;
}

export type ApprovalDecision = "approved" | "rejected" | "always";

export interface ApprovalHandler {
  request(request: ApprovalRequest): Promise<ApprovalDecision>;
}

/** Test/headless handler. Never auto-approves unless explicitly configured. */
export class StaticApprovalHandler implements ApprovalHandler {
  constructor(private readonly decision: ApprovalDecision = "rejected") {}

  async request(): Promise<ApprovalDecision> {
    return this.decision;
  }
}

/** Denies everything; used by `--read-only` and non-interactive runs without approval flags. */
export class DenyAllApprovalHandler implements ApprovalHandler {
  async request(): Promise<ApprovalDecision> {
    return "rejected";
  }
}
