import type { ErrorCategory } from "./types.ts";

/** Typed, redaction-safe error used across FLUX. */
export class FluxError extends Error {
  readonly category: ErrorCategory;
  readonly retryable: boolean;
  readonly status?: number;
  readonly details?: Record<string, unknown>;

  constructor(
    category: ErrorCategory,
    message: string,
    options: { retryable?: boolean; status?: number; details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "FluxError";
    this.category = category;
    this.retryable = options.retryable ?? false;
    this.status = options.status;
    this.details = options.details;
  }
}

export function isFluxError(error: unknown): error is FluxError {
  return error instanceof FluxError;
}

export function describeError(error: unknown): string {
  if (isFluxError(error)) return `${error.category}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Classify an HTTP/network failure. Only quota/rate-limit/transient failures are
 * fallback-eligible. Auth, permission, malformed request and unsupported
 * capability errors must surface to the user.
 */
export function classifyHttpError(status: number, body: string): FluxError {
  const snippet = body.slice(0, 400);
  if (status === 401 || status === 403) {
    return new FluxError("provider-auth", `Provider rejected the credential (HTTP ${status}).`, {
      status,
      details: { snippet },
    });
  }
  if (status === 429) {
    const quota = /quota|insufficient|allowance|exhaust|daily|balance/i.test(body);
    return new FluxError(quota ? "quota-exhausted" : "rate-limit", quota
      ? "Provider quota is exhausted (HTTP 429)."
      : "Provider rate limit reached (HTTP 429).", {
      retryable: true,
      status,
      details: { snippet },
    });
  }
  if (status >= 500 || status === 408 || status === 409) {
    return new FluxError("transient", `Provider service error (HTTP ${status}).`, {
      retryable: true,
      status,
      details: { snippet },
    });
  }
  if (status === 404) {
    return new FluxError("unsupported-capability", `Provider endpoint or model was not found (HTTP 404).`, {
      status,
      details: { snippet },
    });
  }
  return new FluxError("parse", `Provider request failed (HTTP ${status}).`, {
    status,
    details: { snippet },
  });
}
