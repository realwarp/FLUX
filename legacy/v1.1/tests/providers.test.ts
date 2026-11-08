import { describe, expect, test } from "bun:test";
import {
  CredentialResolver,
  OpenAICompatibleProvider,
  UNKNOWN_CAPABILITIES,
  streamWithFallback,
  type ModelProvider,
  type ModelTarget,
} from "@flux/providers";
import { FluxError, type ModelEvent, type ProviderProfile } from "@flux/shared";

function profile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: "local",
    displayName: "Local",
    protocol: "openai-compatible",
    baseURL: "http://127.0.0.1:11434/v1",
    credentialRef: "env:TEST_API_KEY",
    enabled: true,
    models: ["test-model"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function target(id: string, profileValue = profile({ id })): ModelTarget {
  return {
    providerProfileId: id,
    modelId: `${id}-model`,
    profile: profileValue,
    capabilities: UNKNOWN_CAPABILITIES,
    source: "default",
  };
}

function sse(chunks: Array<Record<string, unknown> | string>): Response {
  const text = chunks
    .map((chunk) => `data: ${typeof chunk === "string" ? chunk : JSON.stringify(chunk)}\n\n`)
    .join("");
  return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
}

async function collect(iterable: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const events: ModelEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

describe("OpenAI-compatible streaming adapter", () => {
  test("streams text, assembles fragmented tool calls and reports usage", async () => {
    let receivedBody: Record<string, unknown> | undefined;
    let authorization: string | undefined;
    const provider = new OpenAICompatibleProvider({
      credentials: new CredentialResolver({ TEST_API_KEY: "super-secret" }),
      fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
        receivedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        authorization = (init?.headers as Record<string, string>)["authorization"];
        return sse([
          { choices: [{ delta: { content: "Hel" } }] },
          { choices: [{ delta: { content: "lo" } }] },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, id: "call_1", function: { name: "read_", arguments: '{"pa' } },
                  ],
                },
              },
            ],
          },
          {
            choices: [
              {
                delta: {
                  tool_calls: [{ index: 0, function: { name: "file", arguments: 'th":"a.ts"}' } }],
                },
              },
            ],
          },
          { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
          { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
          "[DONE]",
        ]);
      }) as unknown as typeof fetch,
    });

    const events = await collect(
      provider.streamChat(profile(), {
        model: "test-model",
        messages: [{ role: "user", content: "hello" }],
        tools: [
          {
            name: "read_file",
            description: "read",
            parameters: { type: "object", properties: { path: { type: "string" } } },
          },
        ],
      }),
    );

    expect(authorization).toBe("Bearer super-secret");
    expect(receivedBody?.["stream"]).toBe(true);
    expect(receivedBody?.["tools"]).toBeArrayOfSize(1);

    const text = events
      .filter((event): event is Extract<ModelEvent, { type: "text-delta" }> => event.type === "text-delta")
      .map((event) => event.text)
      .join("");
    expect(text).toBe("Hello");

    const toolCall = events.find((event) => event.type === "tool-call");
    expect(toolCall).toMatchObject({
      type: "tool-call",
      call: { id: "call_1", name: "read_file", parsed: { path: "a.ts" } },
    });

    const usage = events.find((event) => event.type === "usage");
    expect(usage).toEqual({ type: "usage", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } });
    expect(events.at(-1)).toMatchObject({ type: "done", finishReason: "tool_calls" });
  });

  test("classifies HTTP 429 quota exhaustion as retryable", async () => {
    const provider = new OpenAICompatibleProvider({
      credentials: new CredentialResolver({}),
      fetchImpl: (async () => new Response("daily quota exhausted", { status: 429 })) as unknown as typeof fetch,
    });
    await expect(
      collect(provider.streamChat(profile({ credentialRef: undefined }), { model: "m", messages: [] })),
    ).rejects.toMatchObject({ category: "quota-exhausted", retryable: true, status: 429 });
  });

  test("does not classify an auth failure as retryable", async () => {
    const provider = new OpenAICompatibleProvider({
      credentials: new CredentialResolver({}),
      fetchImpl: (async () => new Response("bad key", { status: 401 })) as unknown as typeof fetch,
    });
    await expect(
      collect(provider.streamChat(profile({ credentialRef: undefined }), { model: "m", messages: [] })),
    ).rejects.toMatchObject({ category: "provider-auth", retryable: false });
  });
});

function fakeProvider(
  events: ModelEvent[],
  error?: FluxError,
): ModelProvider & { calls: number } {
  const provider = {
    id: "fake",
    calls: 0,
    async *streamChat(): AsyncIterable<ModelEvent> {
      provider.calls += 1;
      for (const event of events) yield event;
      if (error) throw error;
    },
  };
  return provider;
}

async function collectRouted(options: Parameters<typeof streamWithFallback>[0]) {
  const routed = [];
  for await (const event of streamWithFallback(options)) routed.push(event);
  return routed;
}

describe("opt-in provider fallback", () => {
  test("falls back on quota exhaustion before any output", async () => {
    const primary = fakeProvider([], new FluxError("quota-exhausted", "quota gone", { retryable: true }));
    const secondary = fakeProvider([{ type: "text-delta", text: "ok" }]);
    const routed = await collectRouted({
      primary: target("primary"),
      fallbacks: [target("secondary")],
      request: { model: "unused", messages: [] },
      providerFor: (value) => (value.providerProfileId === "primary" ? primary : secondary),
      enabled: true,
    });

    expect(primary.calls).toBe(1);
    expect(secondary.calls).toBe(1);
    expect(routed.some((event) => event.type === "fallback")).toBe(true);
    expect(routed.at(-1)).toMatchObject({ type: "model-event", event: { type: "text-delta", text: "ok" } });
  });

  test("does not fall back when disabled", async () => {
    const primary = fakeProvider([], new FluxError("quota-exhausted", "quota gone", { retryable: true }));
    const secondary = fakeProvider([{ type: "text-delta", text: "ok" }]);
    await expect(
      collectRouted({
        primary: target("primary"),
        fallbacks: [target("secondary")],
        request: { model: "unused", messages: [] },
        providerFor: (value) => (value.providerProfileId === "primary" ? primary : secondary),
        enabled: false,
      }),
    ).rejects.toMatchObject({ category: "quota-exhausted" });
    expect(secondary.calls).toBe(0);
  });

  test("does not fall back on auth errors", async () => {
    const primary = fakeProvider([], new FluxError("provider-auth", "bad key"));
    const secondary = fakeProvider([{ type: "text-delta", text: "ok" }]);
    await expect(
      collectRouted({
        primary: target("primary"),
        fallbacks: [target("secondary")],
        request: { model: "unused", messages: [] },
        providerFor: (value) => (value.providerProfileId === "primary" ? primary : secondary),
        enabled: true,
      }),
    ).rejects.toMatchObject({ category: "provider-auth" });
    expect(secondary.calls).toBe(0);
  });

  test("never replays after partial text", async () => {
    const primary = fakeProvider(
      [{ type: "text-delta", text: "partial" }],
      new FluxError("transient", "stream dropped", { retryable: true }),
    );
    const secondary = fakeProvider([{ type: "text-delta", text: "duplicate" }]);
    await expect(
      collectRouted({
        primary: target("primary"),
        fallbacks: [target("secondary")],
        request: { model: "unused", messages: [] },
        providerFor: (value) => (value.providerProfileId === "primary" ? primary : secondary),
        enabled: true,
      }),
    ).rejects.toMatchObject({ category: "transient" });
    expect(secondary.calls).toBe(0);
  });

  test("never duplicates an already-emitted tool call", async () => {
    const primary = fakeProvider(
      [
        {
          type: "tool-call",
          call: { id: "call_1", name: "read_file", arguments: '{"path":"a.ts"}', parsed: { path: "a.ts" } },
        },
      ],
      new FluxError("network", "connection reset", { retryable: true }),
    );
    const secondary = fakeProvider([]);
    const routed: Awaited<ReturnType<typeof collectRouted>> = [];
    await expect(
      (async () => {
        for await (const event of streamWithFallback({
          primary: target("primary"),
          fallbacks: [target("secondary")],
          request: { model: "unused", messages: [] },
          providerFor: (value) => (value.providerProfileId === "primary" ? primary : secondary),
          enabled: true,
        })) {
          routed.push(event);
        }
      })(),
    ).rejects.toMatchObject({ category: "network" });

    const toolCalls = routed.filter(
      (event) => event.type === "model-event" && event.event.type === "tool-call",
    );
    expect(toolCalls).toHaveLength(1);
    expect(secondary.calls).toBe(0);
  });
});
