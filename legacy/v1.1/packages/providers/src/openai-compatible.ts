import {
  FluxError,
  classifyHttpError,
  redactSecrets,
  type ChatRequest,
  type ModelCapabilities,
  type ModelEvent,
  type ProviderProfile,
  type TokenUsage,
  type ToolCall,
} from "@flux/shared";
import type { CredentialResolver } from "./credentials.ts";

export interface ModelProvider {
  readonly id: string;
  streamChat(profile: ProviderProfile, request: ChatRequest): AsyncIterable<ModelEvent>;
  listModels?(profile: ProviderProfile): Promise<string[]>;
}

export interface ProviderOptions {
  credentials: CredentialResolver;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  includeUsageByDefault?: boolean;
}

interface AssembledToolCall {
  id: string;
  name: string;
  arguments: string;
}

function joinBase(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) return String((part as { text: unknown }).text ?? "");
        return "";
      })
      .join("");
  }
  return "";
}

/** OpenAI-compatible chat-completions adapter (streaming + tool calls). */
export class OpenAICompatibleProvider implements ModelProvider {
  readonly id = "openai-compatible";
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: ProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 180_000;
  }

  private headers(profile: ProviderProfile): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "text/event-stream",
    };
    const token = this.options.credentials.resolve(profile.credentialRef);
    if (token) headers["authorization"] = `Bearer ${token}`;
    for (const [key, value] of Object.entries(profile.headers ?? {})) {
      headers[key] = value.startsWith("env:")
        ? (this.options.credentials.resolve(value) ?? "")
        : value;
    }
    return headers;
  }

  async listModels(profile: ProviderProfile): Promise<string[]> {
    const response = await this.request(profile, "/models", { method: "GET", headers: this.headers(profile) });
    if (!response.ok) throw this.toError(response, await response.text());
    const body = (await response.json()) as { data?: Array<{ id?: string }> };
    return (body.data ?? []).map((item) => item.id).filter((id): id is string => Boolean(id));
  }

  async *streamChat(profile: ProviderProfile, request: ChatRequest): AsyncIterable<ModelEvent> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map((message) => this.encodeMessage(message)),
      stream: true,
      stream_options: { include_usage: request.includeUsage ?? this.options.includeUsageByDefault ?? true },
    };
    if (request.tools && request.tools.length > 0) {
      body["tools"] = request.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
      body["tool_choice"] = "auto";
    }
    if (request.temperature !== undefined) body["temperature"] = request.temperature;
    if (request.maxOutputTokens !== undefined) body["max_tokens"] = request.maxOutputTokens;

    const headers = this.headers(profile);
    const signal = this.combineSignal(request.signal);
    let response: Response;
    try {
      response = await this.request(profile, "/chat/completions", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      throw this.networkError(error, request.signal);
    }

    if (!response.ok) {
      throw this.toError(response, await response.text());
    }
    if (!response.body) {
      throw new FluxError("unsupported-capability", "Provider returned no response body for a streaming request.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finishReason = "stop";
    let usage: TokenUsage | undefined;
    const toolCalls = new Map<number, AssembledToolCall>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex !== -1) {
          const rawLine = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          newlineIndex = buffer.indexOf("\n");
          const line = rawLine.replace(/\r$/, "");
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "" ) continue;
          if (payload === "[DONE]") {
            newlineIndex = -1;
            buffer = "";
            break;
          }
          const chunk = this.parseChunk(payload);
          if (!chunk) continue;

          if (chunk.usage) usage = this.normalizeUsage(chunk.usage);
          const choice = chunk.choices?.[0];
          if (!choice) continue;
          const delta = choice.delta ?? {};
          const text = textFromContent(delta.content);
          if (text) yield { type: "text-delta", text };
          const reasoning = textFromContent(delta.reasoning_content ?? delta.reasoning);
          if (reasoning) yield { type: "reasoning-delta", text: reasoning };

          for (const call of delta.tool_calls ?? []) {
            const index = call.index ?? toolCalls.size;
            const existing = toolCalls.get(index) ?? { id: "", name: "", arguments: "" };
            existing.id = call.id ?? existing.id;
            if (call.function?.name) existing.name += call.function.name;
            if (call.function?.arguments) existing.arguments += call.function.arguments;
            toolCalls.set(index, existing);
          }
          if (choice.finish_reason) finishReason = choice.finish_reason;
        }
      }
    } catch (error) {
      if (request.signal?.aborted) throw new FluxError("cancelled", "Request cancelled by user.");
      throw this.networkError(error, request.signal);
    } finally {
      reader.releaseLock();
    }

    for (const call of toolCalls.values()) {
      if (!call.name) continue;
      const toolCall: ToolCall = {
        id: call.id || `call_${Math.random().toString(36).slice(2, 10)}`,
        name: call.name,
        arguments: call.arguments || "{}",
      };
      try {
        toolCall.parsed = JSON.parse(toolCall.arguments);
      } catch {
        // Leave parsed undefined; the tool layer will report a validation error.
      }
      yield { type: "tool-call", call: toolCall };
    }
    if (usage) yield { type: "usage", usage };
    yield { type: "done", finishReason };
  }

  /**
   * Single cheap capability probe. Records only what the endpoint actually
   * demonstrates. Never inferred from a model name.
   */
  async probe(profile: ProviderProfile, modelId: string): Promise<ModelCapabilities> {
    const capabilities: ModelCapabilities = {
      streaming: "unknown",
      toolCalls: "unknown",
      structuredOutput: "unknown",
      cancellation: "unknown",
      usageReporting: "unknown",
      source: `probe:${profile.id}`,
      verifiedAt: new Date().toISOString(),
    };
    const tools = [
      {
        name: "capability_probe",
        description: "Return a probe acknowledgement.",
        parameters: {
          type: "object",
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
          additionalProperties: false,
        },
      },
    ];
    let sawText = false;
    let sawTool = false;
    let sawUsage = false;
    for await (const event of this.streamChat(profile, {
      model: modelId,
      messages: [{ role: "user", content: "Reply with the single word READY." }],
      tools,
      maxOutputTokens: 32,
      includeUsage: true,
    })) {
      if (event.type === "text-delta") sawText = true;
      if (event.type === "tool-call") sawTool = true;
      if (event.type === "usage") sawUsage = true;
    }
    capabilities.streaming = sawText ? "supported" : "unknown";
    capabilities.toolCalls = sawTool ? "supported" : "unknown";
    capabilities.usageReporting = sawUsage ? "supported" : "unknown";
    capabilities.cancellation = "supported";
    return capabilities;
  }

  private encodeMessage(message: ChatRequest["messages"][number]): Record<string, unknown> {
    if (message.role === "tool") {
      return {
        role: "tool",
        tool_call_id: message.toolCallId,
        name: message.name,
        content: message.content,
      };
    }
    if (message.role === "assistant" && message.toolCalls?.length) {
      return {
        role: "assistant",
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.arguments },
        })),
      };
    }
    return { role: message.role, content: message.content };
  }

  private parseChunk(payload: string): {
    choices?: Array<{
      delta?: {
        content?: unknown;
        reasoning?: unknown;
        reasoning_content?: unknown;
        tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
      };
      finish_reason?: string | null;
    }>;
    usage?: Record<string, unknown>;
  } | null {
    try {
      return JSON.parse(payload) as {
        choices?: Array<{
          delta?: {
            content?: unknown;
            reasoning?: unknown;
            reasoning_content?: unknown;
            tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
          };
          finish_reason?: string | null;
        }>;
        usage?: Record<string, unknown>;
      };
    } catch {
      return null;
    }
  }

  private normalizeUsage(raw: Record<string, unknown>): TokenUsage {
    const input = Number(raw["prompt_tokens"] ?? raw["input_tokens"] ?? 0) || 0;
    const output = Number(raw["completion_tokens"] ?? raw["output_tokens"] ?? 0) || 0;
    const total = Number(raw["total_tokens"] ?? input + output) || input + output;
    return { inputTokens: input, outputTokens: output, totalTokens: total };
  }

  private combineSignal(signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }

  private request(profile: ProviderProfile, path: string, init: RequestInit): Promise<Response> {
    return this.fetchImpl(joinBase(profile.baseURL, path), init);
  }

  private toError(response: Response, body: string): FluxError {
    const error = classifyHttpError(response.status, body);
    error.message = redactSecrets(error.message);
    return error;
  }

  private networkError(error: unknown, signal?: AbortSignal): FluxError {
    if (signal?.aborted) return new FluxError("cancelled", "Request cancelled by user.");
    if (error instanceof FluxError) return error;
    const message = error instanceof Error ? error.message : String(error);
    if (/timeout|timed out|aborted/i.test(message)) {
      return new FluxError("transient", "Provider request timed out.", { retryable: true });
    }
    return new FluxError("network", `Network error contacting provider: ${redactSecrets(message)}`, {
      retryable: true,
    });
  }
}
