// Approval decisions for operations that can change or execute workspace state.
export type ApprovalOperation = "read" | "search" | "write" | "patch" | "shell";
export type ApprovalDecision = "allow" | "deny" | "ask";

export interface ApprovalRequest {
  readonly operation: ApprovalOperation;
  readonly description: string;
  readonly path?: string;
  readonly command?: string;
  readonly preview?: string;
}

export interface ApprovalPolicyOptions {
  readonly allowReads?: boolean;
  readonly allowWrites?: boolean;
  readonly allowShell?: boolean;
  readonly approve?: (request: ApprovalRequest) => boolean | Promise<boolean>;
}

export class ApprovalDenied extends Error {
  readonly code = "APPROVAL_DENIED";
}

export class ApprovalPolicy {
  private readonly options: Required<Pick<ApprovalPolicyOptions, "allowReads" | "allowWrites" | "allowShell">> &
    Pick<ApprovalPolicyOptions, "approve">;

  constructor(options: ApprovalPolicyOptions = {}) {
    this.options = {
      allowReads: options.allowReads ?? true,
      allowWrites: options.allowWrites ?? false,
      allowShell: options.allowShell ?? false,
      approve: options.approve,
    };
  }

  async require(request: ApprovalRequest): Promise<void> {
    const automatic = request.operation === "read" || request.operation === "search"
      ? this.options.allowReads
      : request.operation === "shell"
        ? this.options.allowShell
        : this.options.allowWrites;
    if (automatic) return;
    if (this.options.approve && await this.options.approve(request)) return;
    throw new ApprovalDenied(`FLUX denied approval for ${request.operation}; the operation was not executed.`);
  }
}

export function createApprovalPolicy(options: ApprovalPolicyOptions = {}): ApprovalPolicy {
  return new ApprovalPolicy(options);
}
