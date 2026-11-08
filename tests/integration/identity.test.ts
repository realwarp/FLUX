import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import type { FluxConfig } from "../../src/config/providers.js";
import { createProviderRegistry } from "../../src/providers/router.js";
import { ApprovalPolicy } from "../../src/safety/approval.js";
import { createWorkspace } from "../../src/safety/workspace.js";
import { createFluxResourceLoader, buildFluxSystemPrompt, type FluxRuntimeContext } from "../../src/agent/system-prompt.js";
import { describe, expect, test } from "bun:test";
import { createFluxToolDefinitions } from "../../src/tools/pi-tools.js";
import { answerWorkspaceQuestion } from "../../src/agent/runtime-info.js";

interface ProviderMessage {
  role: string;
  content?: string | Array<{ type: string; text?: string }>;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

interface ProviderRequest {
  model: string;
  messages: ProviderMessage[];
  tools?: Array<{ type: string; function: { name: string } }>;
}

type ToolCall = { name: string; arguments: Record<string, unknown> };
type Reply = { content: string } | { toolCall: ToolCall };
type Responder = (request: ProviderRequest) => Reply;

describe("FLUX identity boundary", () => {
  test("answers direct workspace questions with the exact configured path", () => {
    const paths = [
      "C:\\Users\\Developer\\Temp Projects\\FLUX",
      "C:\\Users\\Developer\\AppData\\Local\\Temp\\flux-live-workspace",
    ];

    for (const cwd of paths) {
      expect(answerWorkspaceQuestion("Where is my current workspace?", cwd))
        .toBe(`Current workspace: ${cwd}`);
      expect(answerWorkspaceQuestion("What is my current workspace?", cwd))
        .toBe(`Current workspace: ${cwd}`);
    }
    expect(answerWorkspaceQuestion("Where is my current workspace? Also read README.md.", paths[0]!)).toBeUndefined();
  });

  test("builds a FLUX prompt with exact native workspace and truthful approval context", () => {
    const cwd = "C:\\Users\\Developer\\Temp Projects\\FLUX";
    const prompt = buildFluxSystemPrompt({
      cwd,
      platform: "win32",
      approvalMode: "interactive",
      applicationSurface: "terminal TUI",
      activeModel: { provider: "ollama", id: "qwen35-9b-20k:latest" },
      describeInferenceRoute: () => "FLUX verified a loopback Ollama model listing; inference forwarding is unknown.",
    });

    expect(prompt).toContain("FLUX — Terminal-native AI Coding Agent");
    expect(prompt).toContain(`<workspace_root>${cwd}</workspace_root>`);
    expect(prompt).toContain("<application_surface>terminal TUI</application_surface>");
    expect(prompt).toContain("<host_os>Windows</host_os>");
    expect(prompt).toContain("<active_provider>ollama</active_provider>");
    expect(prompt).toContain("<active_model>qwen35-9b-20k:latest</active_model>");
    expect(prompt).toContain("<inference_route>FLUX verified a loopback Ollama model listing; inference forwarding is unknown.</inference_route>");
    expect(prompt).toContain("Preserve Windows drive letters and backslashes exactly.");
    expect(prompt).toContain("write, patch, and shell require explicit user approval");
    expect(prompt).toContain("require explicit per-operation FLUX approval in interactive mode");
    expect(prompt).toContain("perform the requested action with the matching FLUX tool in the current turn");
    expect(prompt).toContain("invoking `write`, `patch`, or `shell` causes the application to display its approval dialog");
    expect(prompt).toContain('A chat message such as "yes" is not an approval decision');
    expect(prompt).toContain("test.txt");
    expect(prompt).toContain("Wait for the actual tool result before saying an operation succeeded");
    expect(prompt).toContain("Do not treat greetings or identity questions as requests for a capability list.");
    expect(prompt).toContain("Do not add workspace, operating-system, model, tool, or capability details.");
    expect(prompt).toContain("Do not repeat a failed or denied tool call unless the user changes the request");
    expect(prompt).toContain("do not omit or abbreviate any available value");
    expect(prompt).not.toContain("C:/Users/Developer");
    expect(prompt).not.toMatch(/[A-Za-z]:[\\/][^\n]*node_modules[\\/]/i);
    expect(prompt).not.toContain("running inside pi");
  });

  test("directs workspace actions through tools and leaves approval to FLUX", () => {
    const base = {
      cwd: "C:\\Work\\FLUX",
      platform: "win32" as NodeJS.Platform,
      applicationSurface: "terminal TUI" as const,
    };
    const interactive = buildFluxSystemPrompt({ ...base, approvalMode: "interactive" });
    expect(interactive).toContain("call the matching FLUX tool in the current turn");
    expect(interactive).toContain("FLUX handles the approval interaction");
    expect(interactive).toContain("A chat message such as \"yes\" is not an approval decision");

    const unavailable = buildFluxSystemPrompt({ ...base, approvalMode: "unavailable" });
    expect(unavailable).toContain("the tool returns a denial");
    expect(unavailable).toContain("do not try to bypass it");
  });

  test("refreshes provider and model context from the active session", () => {
    let activeModel = { provider: "ollama", id: "qwen35-9b-20k:latest" };
    const context = {
      cwd: "C:\\Work\\FLUX",
      platform: "win32" as NodeJS.Platform,
      approvalMode: "interactive" as const,
      applicationSurface: "terminal TUI" as const,
      getActiveModel: () => activeModel,
      describeInferenceRoute: (model: { provider: string; id: string }) => `${model.provider}/${model.id} route`,
    };

    expect(buildFluxSystemPrompt(context)).toContain("<active_model>qwen35-9b-20k:latest</active_model>");
    activeModel = { provider: "ollama", id: "qwen35-9b-32k:latest" };
    const switchedPrompt = buildFluxSystemPrompt(context);
    expect(switchedPrompt).toContain("<active_model>qwen35-9b-32k:latest</active_model>");
    expect(switchedPrompt).toContain("<inference_route>ollama/qwen35-9b-32k:latest route</inference_route>");
  });

  test("sends one authoritative FLUX prompt and only FLUX tools to an actual provider request", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "flux identity workspace-"));
    const provider = await createProviderStub(() => ({ content: "Hey! What's up?" }));
    let session: Awaited<ReturnType<typeof createSession>> | undefined;
    let answer = "";
    let activeModel = { provider: "openai-compatible", id: "flux-test-model" };
    try {
      session = await createSession(cwd, provider.url, new ApprovalPolicy(), undefined, undefined, {
        getActiveModel: () => activeModel,
      });
      session.session.subscribe((event) => {
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          answer += event.assistantMessageEvent.delta;
        }
      });
      await session.session.prompt("sup");

      expect(answer).toBe("Hey! What's up?");
      expect(provider.requests).toHaveLength(1);
      const request = provider.requests[0]!;
      const systemMessages = request.messages.filter((message) => message.role === "system");
      expect(systemMessages).toHaveLength(1);
      expect(systemMessages[0]?.content).toBe(buildFluxSystemPrompt({
        cwd,
        platform: process.platform,
        approvalMode: "interactive",
        applicationSurface: "terminal CLI",
        getActiveModel: () => ({ provider: "openai-compatible", id: "flux-test-model" }),
        describeInferenceRoute: () => "The test provider route is configured; inference location is unknown.",
      }));
      expect(systemMessages[0]?.content).toContain("<application_surface>terminal CLI</application_surface>");
      expect(systemMessages[0]?.content).toContain("<active_provider>openai-compatible</active_provider>");
      expect(systemMessages[0]?.content).toContain("<active_model>flux-test-model</active_model>");
      expect(systemMessages[0]?.content).toContain("<inference_route>The test provider route is configured; inference location is unknown.</inference_route>");
      expect(systemMessages[0]?.content).not.toMatch(/[A-Za-z]:[\\/][^\n]*node_modules[\\/]/i);
      expect(systemMessages[0]?.content).not.toContain("Additional tools may be available");
      expect(request.messages.at(-1)?.role).toBe("user");
      expect(messageText(request.messages.at(-1)!)).toBe("sup");
      expect(request.tools?.map((tool) => tool.function.name).sort()).toEqual([
        "patch",
        "read",
        "search",
        "shell",
        "write",
      ]);

      const currentModel = session.session.model;
      if (!currentModel) throw new Error("The test session has no active model.");
      const switchedModel = { ...currentModel, id: "flux-test-model-switched", name: "flux-test-model-switched" };
      await session.session.setModel(switchedModel);
      activeModel = { provider: switchedModel.provider, id: switchedModel.id };
      await session.session.prompt("Where are you running and what are you running on?");
      const switchedRequest = provider.requests.at(-1)!;
      const switchedSystem = switchedRequest.messages.find((message) => message.role === "system")?.content ?? "";
      expect(switchedRequest.model).toBe("flux-test-model-switched");
      expect(switchedSystem).toContain("<active_model>flux-test-model-switched</active_model>");
    } finally {
      session?.session.dispose();
      await provider.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("reapplies the trusted identity after session restoration and workspace changes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flux identity sessions-"));
    const firstCwd = path.join(root, "first");
    const secondCwd = path.join(root, "second");
    const sessionDir = path.join(root, "sessions");
    const secondSessionDir = path.join(root, "sessions-second");
    await mkdir(firstCwd);
    await mkdir(secondCwd);
    const provider = await createProviderStub(() => ({ content: "I'm FLUX, the terminal-native AI coding agent." }));
    const manager = SessionManager.create(firstCwd, sessionDir);
    let firstSession: Awaited<ReturnType<typeof createSession>> | undefined;
    let resumedSession: Awaited<ReturnType<typeof createSession>> | undefined;
    let secondWorkspaceSession: Awaited<ReturnType<typeof createSession>> | undefined;
    try {
      firstSession = await createSession(firstCwd, provider.url, new ApprovalPolicy(), undefined, manager);
      await firstSession.session.prompt("Who are you?");
      const sessionFile = manager.getSessionFile();
      if (!sessionFile) throw new Error("The identity test session was not persisted.");
      firstSession.session.dispose();

      resumedSession = await createSession(
        firstCwd,
        provider.url,
        new ApprovalPolicy(),
        undefined,
        SessionManager.open(sessionFile, sessionDir),
      );
      await resumedSession.session.prompt("What is my current workspace?");
      const restoredRequest = provider.requests.at(-1)!;
      const restoredSystem = restoredRequest.messages.find((message) => message.role === "system")?.content ?? "";
      expect(restoredSystem).toContain(`<workspace_root>${firstCwd}</workspace_root>`);
      expect(restoredRequest.messages.some((message) => messageText(message).includes("Who are you?"))).toBe(true);

      secondWorkspaceSession = await createSession(
        secondCwd,
        provider.url,
        new ApprovalPolicy(),
        undefined,
        SessionManager.create(secondCwd, secondSessionDir),
      );
      await secondWorkspaceSession.session.prompt("What is my current workspace?");
      const switchedRequest = provider.requests.at(-1)!;
      const switchedSystem = switchedRequest.messages.find((message) => message.role === "system")?.content ?? "";
      expect(switchedSystem).toContain(`<workspace_root>${secondCwd}</workspace_root>`);
      expect(switchedSystem).not.toContain(firstCwd);
      expect(switchedRequest.messages.some((message) =>
        message.role === "user" && messageText(message).includes("Who are you?"),
      )).toBe(false);
    } finally {
      firstSession?.session.dispose();
      resumedSession?.session.dispose();
      secondWorkspaceSession?.session.dispose();
      await provider.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("uses actual read tool results and preserves denied write approval", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "flux identity tools-"));
    const taskText = "FLUX identity workspace fixture";
    await Bun.write(path.join(cwd, "TASKS.md"), taskText);
    const provider = await createProviderStub((request) => {
      const lastUserIndex = request.messages.findLastIndex((message) => message.role === "user");
      const userPrompt = messageText(request.messages[lastUserIndex]!);
      const latestTool = request.messages.slice(lastUserIndex + 1).findLast((message) => message.role === "tool");
      if (userPrompt === "Read TASKS.md" && !latestTool) {
        return { toolCall: { name: "read", arguments: { path: "TASKS.md" } } };
      }
      if (userPrompt === "Create a small test file" && !latestTool) {
        return { toolCall: { name: "write", arguments: { path: "denied.txt", content: "must not exist" } } };
      }
      if (userPrompt === "Read with a missing argument" && !latestTool) {
        return { toolCall: { name: "read", arguments: {} } };
      }
      if (userPrompt === "Read an inaccessible file" && !latestTool) {
        return { toolCall: { name: "read", arguments: { path: "missing.txt" } } };
      }
      return {
        content: latestTool && messageText(latestTool).includes(taskText)
          ? `Read result: ${taskText}`
          : latestTool
            ? messageText(latestTool).toLowerCase().includes("flux denied")
              ? "The write was denied by FLUX."
              : `Tool error: ${messageText(latestTool)}`
            : "The write was denied by FLUX.",
      };
    });
    let session: Awaited<ReturnType<typeof createSession>> | undefined;
    let answer = "";
    try {
      session = await createSession(cwd, provider.url, new ApprovalPolicy());
      session.session.subscribe((event) => {
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          answer += event.assistantMessageEvent.delta;
        }
      });
      await session.session.prompt("Read TASKS.md");
      expect(answer).toContain(taskText);
      expect(provider.requests[0]?.tools?.map((tool) => tool.function.name)).toContain("read");
      expect(provider.requests.length).toBeGreaterThanOrEqual(2);
      expect(provider.requests.at(-1)?.messages.some((message) => message.role === "tool" && messageText(message).includes(taskText))).toBe(true);

      answer = "";
      await session.session.prompt("Create a small test file");
      expect(answer).toContain("denied");
      expect(provider.requests.at(-1)?.messages.some((message) =>
        message.role === "tool" && messageText(message).includes("the operation was not executed"),
      )).toBe(true);
      await expect(readFile(path.join(cwd, "denied.txt"), "utf8")).rejects.toThrow();

      answer = "";
      const missingArgumentStart = provider.requests.length;
      await session.session.prompt("Read with a missing argument");
      expect(answer.toLowerCase()).toContain("path");
      expect(provider.requests.length - missingArgumentStart).toBe(2);

      answer = "";
      const inaccessibleStart = provider.requests.length;
      await session.session.prompt("Read an inaccessible file");
      expect(answer.toLowerCase()).toContain("enoent");
      expect(provider.requests.length - inaccessibleStart).toBe(2);
    } finally {
      session?.session.dispose();
      await provider.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

async function createSession(
  cwd: string,
  baseUrl: string,
  policy: ApprovalPolicy,
  runtime?: ModelRuntime,
  manager?: SessionManager,
  runtimeContext: Pick<FluxRuntimeContext, "applicationSurface" | "activeModel" | "getActiveModel" | "describeInferenceRoute"> = {},
) {
  const modelRuntime = runtime ?? await createRuntime(baseUrl);
  const config = createConfig(baseUrl);
  const model = modelRuntime.getModel("openai-compatible", "flux-test-model");
  if (!model) throw new Error("Test provider model was not registered");
  const resourceLoader = await createFluxResourceLoader({
    cwd,
    platform: process.platform,
    approvalMode: "interactive",
    applicationSurface: "terminal CLI",
    activeModel: { provider: model.provider, id: model.id },
    describeInferenceRoute: () => "The test provider route is configured; inference location is unknown.",
    ...runtimeContext,
  });
  return createAgentSession({
    cwd,
    modelRuntime,
    model,
    sessionManager: manager ?? SessionManager.inMemory(cwd),
    resourceLoader,
    noTools: "builtin",
    customTools: createFluxToolDefinitions(createWorkspace(cwd), policy),
  });
}

async function createRuntime(baseUrl: string): Promise<ModelRuntime> {
  const runtime = await ModelRuntime.create({ refreshOnCreate: false });
  const config = createConfig(baseUrl);
  for (const provider of createProviderRegistry(config).getProviders()) {
    runtime.registerNativeProvider(provider);
  }
  return runtime;
}

function createConfig(baseUrl: string): FluxConfig {
  return {
    defaultProvider: "openai-compatible",
    defaultModel: "flux-test-model",
    providers: {
      "openai-compatible": {
        name: "openai-compatible",
        model: "flux-test-model",
        baseUrl,
        apiKey: "identity-test-key",
        enabled: true,
      },
    },
  };
}

async function createProviderStub(respond: Responder): Promise<{
  url: string;
  requests: ProviderRequest[];
  close: () => Promise<void>;
}> {
  const requests: ProviderRequest[] = [];
  const server = createServer((request, response) => {
    void readRequestBody(request).then((body) => {
      const providerRequest = JSON.parse(body) as ProviderRequest;
      requests.push(providerRequest);
      const reply = respond(providerRequest);
      response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
      if ("toolCall" in reply) {
        response.write(event({
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index: 0,
                id: `call-${requests.length}`,
                type: "function",
                function: {
                  name: reply.toolCall.name,
                  arguments: JSON.stringify(reply.toolCall.arguments),
                },
              }],
            },
            finish_reason: null,
          }],
        }));
        response.write(event({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }));
      } else {
        response.write(event({
          choices: [{
            index: 0,
            delta: { role: "assistant", content: reply.content },
            finish_reason: null,
          }],
        }));
        response.write(event({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }));
      }
      response.end("data: [DONE]\n\n");
    }).catch((error: unknown) => {
      response.writeHead(500);
      response.end(error instanceof Error ? error.message : String(error));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function event(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function messageText(message: ProviderMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content?.map((item) => item.text ?? "").join("") ?? "";
}
