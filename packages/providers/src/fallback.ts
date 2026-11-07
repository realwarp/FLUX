import {
  FluxError,
  classifyHttpError,
  isFluxError,
  type ChatRequest,
  type ErrorCategory,
  type ModelEvent,
} from "@flux/shared";
import type { ModelProvider } from "./openai-compatible.ts";
import { describeTarget, type ModelTarget } from "./router.ts";

export type RoutedEvent =
  | { type: "provider-start"; target: ModelTarget; attempt: number }
  | { type: "model-event"; target: ModelTarget; event: ModelEvent }
  | {
      type: "fallback";
      from: ModelTarget;
      to: ModelTarget;
      reason: string;
      category: ErrorCategory;
    };

/** Only these categories are eligible for automatic fallback. */
export const FALLBACK_ELIGIBLE: ReadonlySet<ErrorCategory> = new Set<ErrorCategory>([
  "quota-exhausted",
  "rate-limit",
  "network",
  "transient",
]);

export interface FallbackOptions {
  primary: ModelTarget;
  fallbacks: ModelTarget[];
  request: ChatRequest;
  providerFor: (target: ModelTarget) => ModelProvider;
  /** User-configured opt-in. When false, only the primary target is attempted. */
  enabled: boolean;
}

/**
 * Streams a request through the configured route, applying fallback only when:
 *  - the user enabled fallback,
 *  - the failure is a classified quota/rate-limit/transient/network error,
 *  - and no partial assistant text/reasoning/tool call has been accepted yet.
 *
 * Tool calls are only emitted once a stream completes, so a fallback can never
 * duplicate tool execution. The caller still deduplicates by tool-call id.
 */
export async function* streamWithFallback(options: FallbackOptions): AsyncGenerator<RoutedEvent> {
  const targets = options.enabled ? [options.primary, ...options.fallbacks] : [options.primary];
  let emittedContent = false;

  for (let attempt = 0; attempt < targets.length; attempt += 1) {
    const target = targets[attempt]!;
    yield { type: "provider-start", target, attempt };
    let failure: FluxError | undefined;

    try {
      const provider = options.providerFor(target);
      const request: ChatRequest = { ...options.request, model: target.modelId };
      for await (const event of provider.streamChat(target.profile, request)) {
        if (
          (event.type === "text-delta" && event.text.length > 0) ||
          (event.type === "reasoning-delta" && event.text.length > 0) ||
          event.type === "tool-call"
        ) {
          emittedContent = true;
        }
        yield { type: "model-event", target, event };
      }
      return;
    } catch (error) {
      failure = normalizeFailure(error);
    }

    const next = targets[attempt + 1];
    const canFallback =
      Boolean(next) &&
      failure.retryable &&
      FALLBACK_ELIGIBLE.has(failure.category) &&
      !emittedContent;

    if (!canFallback || !next) {
      throw failure;
    }
    yield {
      type: "fallback",
      from: target,
      to: next,
      reason: failure.message,
      category: failure.category,
    };
  }
}

function normalizeFailure(error: unknown): FluxError {
  if (isFluxError(error)) return error;
  if (error instanceof Error) {
    return new FluxError("internal", error.message, { cause: error });
  }
  return new FluxError("internal", String(error));
}

export function summarizeRoute(primary: ModelTarget, fallbacks: ModelTarget[], enabled: boolean): string {
  const head = describeTarget(primary);
  if (!enabled || fallbacks.length === 0) return head;
  return `${head} → ${fallbacks.map(describeTarget).join(" → ")}`;
}

export { classifyHttpError };
