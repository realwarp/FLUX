#!/usr/bin/env node

import { createInterface } from "node:readline";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { createFluxResourceLoader, type MutationApprovalMode } from "./agent/system-prompt.js";
import { answerWorkspaceQuestion, appendWorkspaceExchange } from "./agent/runtime-info.js";
import { hasConfigFile, loadConfig, type FluxConfig, type ProviderName } from "./config/providers.js";
import { runProviderSetup } from "./config/setup.js";
import { SessionStore } from "./sessions/records.js";
import { createProviderRegistry, describeInferenceRoute, getConfiguredModelReadiness, listOllamaModelIds } from "./providers/router.js";
import { FluxPiApp, renderAssistantDelta, renderError, renderHelp, renderStatus, renderToolEvent, renderWelcome } from "./ui/index.js";
import { ApprovalPolicy } from "./safety/approval.js";
import { createWorkspace } from "./safety/workspace.js";
import { ApprovalBroker, createFluxToolDefinitions } from "./tools/pi-tools.js";
import { searchTool } from "./tools/search.js";

const args = new Set(process.argv.slice(2));
if (args.has("--help") || args.has("-h")) {
  process.stdout.write(`${renderHelp()}\n`);
  process.exit(0);
}
if (args.has("--version") || args.has("-v")) {
  process.stdout.write(`FLUX ${readFluxVersion()}\n`);
  process.exit(0);
}
const cwdArgument = process.argv.find((argument) => argument.startsWith("--cwd="));
const cwd = resolve(cwdArgument ? cwdArgument.slice("--cwd=".length) : process.cwd());
const oneShot = process.argv.find((argument) => argument.startsWith("--prompt="))?.slice("--prompt=".length);
const changesApproved = args.has("--approve");
const approvalMode: MutationApprovalMode = changesApproved
  ? "automatic"
  : oneShot === undefined && process.stdin.isTTY && process.stdout.isTTY
    ? "interactive"
    : "unavailable";

const sessionManager = args.has("--resume")
  ? SessionManager.continueRecent(cwd)
  : SessionManager.create(cwd);

const interactiveTerminal = process.stdin.isTTY && process.stdout.isTTY;
const setupRequested = args.has("setup");
let config: FluxConfig | undefined;
try {
  config = await loadConfig();
} catch (error) {
  if (!interactiveTerminal) {
    exitWithError(`${error instanceof Error ? error.message : String(error)} Run "flux setup" in an interactive terminal.`);
  }
  process.stderr.write(`${renderError(`${error instanceof Error ? error.message : String(error)} Starting guided setup.`)}\n`);
}

let configExists: boolean;
try {
  configExists = await hasConfigFile();
} catch (error) {
  exitWithError(error instanceof Error ? error.message : String(error));
}
if (
  setupRequested ||
  (!configExists && !process.env.FLUX_PROVIDER) ||
  (!config?.defaultProvider && !process.env.FLUX_PROVIDER)
) {
  if (!interactiveTerminal) exitWithError(`Provider setup is required. Run "flux setup" in an interactive terminal.`);
  try {
    config = await runProviderSetup(config);
  } catch (error) {
    exitWithError(error instanceof Error ? error.message : String(error));
  }
}
if (!config) exitWithError(`No valid FLUX configuration is available. Run "flux setup".`);

let ollamaModelIds = await listOllamaModelIds(config);
let configuredProvider: ProviderName = config.defaultProvider ?? "ollama";
let configuredModel = config.defaultModel ?? config.providers[configuredProvider]?.model;
let modelReadiness = getConfiguredModelReadiness(config, configuredProvider, configuredModel, ollamaModelIds);
let selectedModel = config.providers[configuredProvider]?.enabled && configuredModel
  ? createProviderRegistry(config, { ollamaModelIds: ollamaModelIds ?? [] }).getModel(configuredProvider, configuredModel)
  : undefined;
if (
  interactiveTerminal &&
  !setupRequested &&
  (!selectedModel || modelReadiness.status === "missing" || modelReadiness.status === "unverified" ||
    modelReadiness.status === "unconfigured" || modelReadiness.status === "disabled")
) {
  process.stderr.write(`${renderError(modelReadiness.message ?? "The configured provider/model is unavailable.")}\n`);
  try {
    config = await runProviderSetup(config);
  } catch (error) {
    exitWithError(error instanceof Error ? error.message : String(error));
  }
  ollamaModelIds = await listOllamaModelIds(config);
  configuredProvider = config.defaultProvider ?? "ollama";
  configuredModel = config.defaultModel ?? config.providers[configuredProvider]?.model;
  modelReadiness = getConfiguredModelReadiness(config, configuredProvider, configuredModel, ollamaModelIds);
  selectedModel = config.providers[configuredProvider]?.enabled && configuredModel
    ? createProviderRegistry(config, { ollamaModelIds: ollamaModelIds ?? [] }).getModel(configuredProvider, configuredModel)
    : undefined;
}
if (!config) exitWithError(`No valid FLUX configuration is available. Run "flux setup".`);
const activeConfig = config;
const modelRuntime = await ModelRuntime.create({ refreshOnCreate: false });
ollamaModelIds = await listOllamaModelIds(activeConfig);
for (const provider of createProviderRegistry(activeConfig, { ollamaModelIds: ollamaModelIds ?? [] }).getProviders()) {
  modelRuntime.registerNativeProvider(provider);
}
selectedModel = configuredProvider && configuredModel
  ? modelRuntime.getModel(configuredProvider, configuredModel)
  : undefined;
const startupModelWarning = modelReadiness.status === "missing" || modelReadiness.status === "unverified"
  ? modelReadiness.message
  : undefined;
if (!selectedModel) {
  process.stderr.write(renderError(
    modelReadiness.message ?? `Configured model ${configuredProvider}/${configuredModel ?? "(none)"} is unavailable.`,
  ));
  process.exit(1);
}
const approvals = new ApprovalBroker(changesApproved);
const workspace = createWorkspace(cwd);
const policy = new ApprovalPolicy({
  approve: (request) => approvals.request(request),
});
const applicationSurface = oneShot === undefined && process.stdin.isTTY && process.stdout.isTTY
  ? "terminal TUI" as const
  : "terminal CLI" as const;
let activeSession: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
async function createFluxSession(manager: SessionManager, model = selectedModel) {
  const resourceLoader = await createFluxResourceLoader({
    cwd,
    platform: process.platform,
    approvalMode,
    applicationSurface,
    getActiveModel: () => {
      const activeModel = activeSession?.model ?? model;
      return activeModel ? { provider: activeModel.provider, id: activeModel.id } : undefined;
    },
    describeInferenceRoute: (activeModel) => describeInferenceRoute(activeConfig, activeModel, ollamaModelIds),
  });
  const { session, modelFallbackMessage } = await createAgentSession({
    cwd,
    modelRuntime,
    model,
    sessionManager: manager,
    resourceLoader,
    noTools: "builtin",
    customTools: createFluxToolDefinitions(workspace, policy),
  });
  const records = new SessionStore(session.sessionId, undefined, cwd);
  if (changesApproved) {
    await records.recordApproval({
      sessionId: session.sessionId,
      action: "mutation tools",
      decision: "approved",
      reason: "The operator supplied --approve at launch.",
    });
  }
  return { session, records, initialError: modelFallbackMessage ?? startupModelWarning };
}
const { session, records, initialError: modelFallbackMessage } = await createFluxSession(sessionManager);
activeSession = session;

const modelName = () => {
  const model = session.model;
  return model ? `${model.provider}/${model.id}` : "not configured";
};

async function currentBranch(): Promise<string | undefined> {
  try {
    const result = await promisify(execFile)("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
    return result.stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

function attachLegacySubscription(): void {
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
      return;
    }
    if (event.type === "agent_end") {
      const last = event.messages.at(-1);
      if (last?.role === "assistant" && last.stopReason === "error") {
        process.stdout.write(renderError(last.errorMessage ?? "Model request failed"));
      }
    }
  });
}

async function prompt(text: string): Promise<void> {
  process.stdout.write("\n");
  await records.appendMessage({ role: "user", content: text });
  const runtimeAnswer = answerWorkspaceQuestion(text, cwd);
  if (runtimeAnswer) {
    appendWorkspaceExchange(session, text, runtimeAnswer);
    await records.appendMessage({ role: "assistant", content: runtimeAnswer });
    process.stdout.write(`${runtimeAnswer}\n`);
    return;
  }
  await session.prompt(text);
  await records.appendMessage({ role: "system", content: "FLUX completed the prompt." });
  process.stdout.write("\n");
}

async function runLegacy(): Promise<void> {
  attachLegacySubscription();
  process.stdout.write(renderWelcome({ cwd, model: modelName(), sessionId: session.sessionId }));
  if (modelFallbackMessage) process.stdout.write(renderError(modelFallbackMessage));

  if (oneShot !== undefined) {
    if (modelReadiness.status === "missing") {
      process.exitCode = 1;
      return;
    }
    await prompt(oneShot);
    return;
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
        sessionPersisted: session.sessionManager.isPersisted(),
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
      try {
        await session.setModel(model);
      } catch (error) {
        process.stdout.write(renderError(error instanceof Error ? error.message : String(error)));
        showPrompt();
        continue;
      }
      process.stdout.write(renderStatus({
        cwd,
        model: modelName(),
        sessionId: session.sessionId,
        sessionPersisted: session.sessionManager.isPersisted(),
      }));
      showPrompt();
      continue;
    }
    if (text === "/diff") {
      try {
        const result = await promisify(execFile)("git", ["--no-pager", "diff", "--"], { cwd, maxBuffer: 256 * 1024 });
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
}

try {
  if (oneShot !== undefined || !process.stdin.isTTY || !process.stdout.isTTY) {
    await runLegacy();
  } else {
    const app = new FluxPiApp({
      cwd,
      branch: await currentBranch(),
      model: modelName(),
      session,
      records,
      approvals,
      config: activeConfig,
      modelRuntime,
      createSession: createFluxSession,
      onSessionChange: (nextSession) => { activeSession = nextSession; },
      searchFiles: (query) => searchTool(workspace, policy, { query, maxResults: 200 }),
      initialError: modelFallbackMessage,
    });
    await app.run();
  }
} finally {
  activeSession?.dispose();
}

function readFluxVersion(): string {
  const directory = dirname(fileURLToPath(import.meta.url));
  for (const packagePath of [resolve(directory, "../package.json"), resolve(directory, "../../package.json")]) {
    try {
      const metadata = JSON.parse(readFileSync(packagePath, "utf8")) as { name?: unknown; version?: unknown };
      if (metadata.name === "flux-coding-agent" && typeof metadata.version === "string") return metadata.version;
    } catch (error) {
      if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
  }
  throw new Error("Unable to read the FLUX package version.");
}

function exitWithError(message: string): never {
  process.stderr.write(`${renderError(message)}\n`);
  process.exit(1);
}
