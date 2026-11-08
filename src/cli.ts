#!/usr/bin/env node

import { createInterface } from "node:readline";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config/providers.js";
import { SessionStore } from "./sessions/records.js";
import { createProviderRegistry } from "./providers/router.js";
import { renderAssistantDelta, renderError, renderHelp, renderStatus, renderToolEvent, renderWelcome } from "./ui/index.js";

const args = new Set(process.argv.slice(2));
const cwdArgument = process.argv.find((argument) => argument.startsWith("--cwd="));
const cwd = resolve(cwdArgument ? cwdArgument.slice("--cwd=".length) : process.cwd());
const oneShot = process.argv.find((argument) => argument.startsWith("--prompt="))?.slice("--prompt=".length);
const changesApproved = args.has("--approve");

const sessionManager = args.has("--resume")
  ? SessionManager.continueRecent(cwd)
  : SessionManager.create(cwd);

const config = await loadConfig();
const modelRuntime = await ModelRuntime.create({ refreshOnCreate: false });
for (const provider of createProviderRegistry(config).getProviders()) {
  modelRuntime.registerNativeProvider(provider);
}
const configuredProvider = config.defaultProvider ?? "ollama";
const configuredModel = config.defaultModel ?? config.providers[configuredProvider]?.model;
const selectedModel = configuredModel ? modelRuntime.getModel(configuredProvider, configuredModel) : undefined;
const tools = changesApproved
  ? ["read", "grep", "find", "ls", "bash", "edit", "write"]
  : ["read", "grep", "find", "ls"];
const { session, modelFallbackMessage } = await createAgentSession({
  cwd,
  modelRuntime,
  model: selectedModel,
  sessionManager,
  tools,
});
const records = new SessionStore(session.sessionId, undefined, cwd);
const runGitDiff = promisify(execFile);
if (changesApproved) {
  await records.recordApproval({
    sessionId: session.sessionId,
    action: "mutation tools",
    decision: "approved",
    reason: "The operator supplied --approve at launch.",
  });
}

const modelName = () => {
  const model = session.model;
  return model ? `${model.provider}/${model.id}` : "not configured";
};

process.stdout.write(renderWelcome({ cwd, model: modelName(), sessionId: session.sessionId }));
if (modelFallbackMessage) process.stdout.write(renderError(modelFallbackMessage));

session.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(renderAssistantDelta(event.assistantMessageEvent.delta));
    return;
  }
  if (event.type === "tool_execution_start") {
    process.stdout.write(renderToolEvent({ name: event.toolName, status: "running" }));
    return;
  }
  if (event.type === "tool_execution_end") {
    process.stdout.write(renderToolEvent({ name: event.toolName, status: event.isError ? "error" : "success" }));
    if (event.toolName === "bash" || event.toolName === "powershell") {
      void records.recordVerification({
        sessionId: session.sessionId,
        command: `Pi ${event.toolName} tool`,
        passed: !event.isError,
        output: JSON.stringify(event.result),
      });
    }
    return;
  }
  if (event.type === "agent_end") {
    const last = event.messages.at(-1);
    if (last?.role === "assistant" && last.stopReason === "error") {
      process.stdout.write(renderError(last.errorMessage ?? "Model request failed"));
    }
  }
});

const prompt = async (text: string) => {
  process.stdout.write("\n");
  await records.appendMessage({ role: "user", content: text });
  await session.prompt(text);
  await records.appendMessage({ role: "system", content: "Pi session completed the prompt." });
  process.stdout.write("\n");
};

if (oneShot !== undefined) {
  await prompt(oneShot);
  session.dispose();
  process.exit(0);
}

process.stdout.write(renderHelp());
const input = createInterface({ input: process.stdin, output: process.stdout, prompt: "\nflux> " });
let inputClosed = false;
input.on("close", () => {
  inputClosed = true;
});
const showPrompt = () => {
  if (!inputClosed) input.prompt();
};
showPrompt();
for await (const line of input) {
  const text = line.trim();
  if (!text) {
    showPrompt();
    continue;
  }
  if (text === "/exit" || text === "/quit") break;
  if (text === "/help") {
    process.stdout.write(renderHelp());
    showPrompt();
    continue;
  }
  if (text === "/status") {
    process.stdout.write(renderStatus({
      cwd,
      model: modelName(),
      sessionId: session.sessionId,
      sessionFile: session.sessionFile,
    }));
    showPrompt();
    continue;
  }
  if (text === "/models") {
    process.stdout.write(modelRuntime.getModels().map((model) => `${model.provider}/${model.id}`).join("\n") + "\n");
    showPrompt();
    continue;
  }
  if (text.startsWith("/model ")) {
    const requested = text.slice("/model ".length).trim();
    const separator = requested.indexOf("/");
    if (separator <= 0 || separator === requested.length - 1) {
      process.stdout.write(renderError("Use /model provider/model"));
      showPrompt();
      continue;
    }
    const provider = requested.slice(0, separator);
    const modelId = requested.slice(separator + 1);
    const model = modelRuntime.getModel(provider, modelId);
    if (!model) {
      process.stdout.write(renderError(`Model not found: ${requested}`));
      showPrompt();
      continue;
    }
    await session.setModel(model);
    process.stdout.write(renderStatus({
      cwd,
      model: modelName(),
      sessionId: session.sessionId,
      sessionFile: session.sessionFile,
    }));
    showPrompt();
    continue;
  }
  if (text === "/diff") {
    try {
      const result = await runGitDiff("git", ["--no-pager", "diff", "--"], { cwd, maxBuffer: 256 * 1024 });
      process.stdout.write(result.stdout || "No changes.\n");
    } catch (error) {
      process.stdout.write(renderError(error instanceof Error ? error.message : String(error)));
    }
    showPrompt();
    continue;
  }
  try {
    await prompt(text);
  } catch (error) {
    process.stdout.write(renderError(error instanceof Error ? error.message : String(error)));
  }
  showPrompt();
}

input.close();
session.dispose();
