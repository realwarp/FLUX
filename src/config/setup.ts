import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { FluxConfig, ProviderConfig, ProviderName } from "./providers.js";
import { saveConfig } from "./providers.js";

export interface SetupPrompter {
  ask(question: string): Promise<string>;
  write(message: string): void;
}

export async function runProviderSetup(
  existingConfig?: FluxConfig,
  prompter?: SetupPrompter,
  fetcher: typeof fetch = fetch,
  configPath?: string,
): Promise<FluxConfig> {
  const ownedInterface = prompter ? undefined : createInterface({ input: stdin, output: stdout });
  const terminal = prompter ?? {
    ask: (question: string) => ownedInterface!.question(question),
    write: (message: string) => stdout.write(message),
  };
  try {
    terminal.write("\nFLUX provider setup\nChoose a provider. You can run `flux setup` again at any time.\n");
    const providerAnswer = (await terminal.ask("1) Ollama (local)  2) OpenAI-compatible endpoint [1]: ")).trim().toLowerCase();
    const providerName: ProviderName = providerAnswer === "2" || providerAnswer === "openai-compatible"
      ? "openai-compatible"
      : providerAnswer === "" || providerAnswer === "1" || providerAnswer === "ollama"
        ? "ollama"
        : fail("Choose 1 for Ollama or 2 for OpenAI-compatible.");

    const config = await configureProvider(providerName, existingConfig, terminal, fetcher);
    await saveConfig(config, configPath);
    terminal.write(`\nFLUX is ready with ${providerName}/${config.defaultModel}. Configuration saved without storing API key values.\n`);
    return config;
  } finally {
    ownedInterface?.close();
  }
}

async function configureProvider(
  providerName: ProviderName,
  existingConfig: FluxConfig | undefined,
  terminal: SetupPrompter,
  fetcher: typeof fetch,
): Promise<FluxConfig> {
  const previous = existingConfig?.providers[providerName];
  const suggestedBaseUrl = previous?.baseUrl ??
    (providerName === "ollama" ? "http://127.0.0.1:11434/v1" : "https://api.openai.com/v1");
  const baseUrl = validateBaseUrl(await terminal.ask(`Base URL [${suggestedBaseUrl}]: `), suggestedBaseUrl);
  let model: string;
  let credentialEnv: string | undefined;
  let displayName: string | undefined;

  if (providerName === "ollama") {
    let installed = await listOllamaModels(baseUrl, fetcher);
    if (installed === undefined) {
      fail(`Ollama is not reachable at ${baseUrl}. Install and start Ollama, then run \`flux setup\` again.`);
    }
    if (installed.length === 0) {
      terminal.write("No Ollama models are installed. Models can be several gigabytes; nothing will be downloaded without confirmation.\n");
      const requestedModel = requireModelId(await terminal.ask("Model ID to download (leave blank to cancel): "));
      const confirm = (await terminal.ask(`Download ${requestedModel} now? This may use several gigabytes of bandwidth and disk. [y/N]: `)).trim().toLowerCase();
      if (confirm !== "y" && confirm !== "yes") fail("Setup cancelled; no model was downloaded.");
      await pullOllamaModel(requestedModel);
      installed = await listOllamaModels(baseUrl, fetcher);
      if (!installed?.some((id) => sameModelId(id, requestedModel))) {
        fail(`Ollama did not report "${requestedModel}" as installed after the download.`);
      }
    }
    terminal.write(`\nInstalled models:\n${installed.map((id, index) => `  ${index + 1}) ${id}`).join("\n")}\n`);
    const answer = (await terminal.ask("Select a model by number or exact ID: ")).trim();
    model = /^\d+$/.test(answer) ? installed[Number(answer) - 1] ?? "" : installed.find((id) => id === answer) ?? "";
    if (!model) fail("Select one of the model IDs shown above.");
    await testOllamaModel(baseUrl, model, fetcher);
  } else {
    displayName = (await terminal.ask(`Provider name [${previous?.displayName ?? "OpenAI-compatible"}]: `)).trim() ||
      previous?.displayName ||
      "OpenAI-compatible";
    model = requireModelId(await terminal.ask(`Model ID${previous?.model ? ` [${previous.model}]` : ""}: `), previous?.model);
    const defaultCredentialEnv = previous?.credentialEnv ?? "OPENAI_API_KEY";
    credentialEnv = (await terminal.ask(`API-key environment variable (optional) [${defaultCredentialEnv}]: `)).trim() ||
      defaultCredentialEnv;
    if (!isEnvironmentName(credentialEnv)) fail("Use a valid environment-variable name such as OPENAI_API_KEY.");
    await testOpenAICompatibleModel(baseUrl, model, process.env[credentialEnv], fetcher);
  }

  const provider: ProviderConfig = {
    name: providerName,
    model,
    baseUrl,
    enabled: true,
    ...(credentialEnv ? { credentialEnv } : {}),
    ...(displayName ? { displayName } : {}),
  };
  return {
    providers: { ...existingConfig?.providers, [providerName]: provider },
    defaultProvider: providerName,
    defaultModel: model,
  };
}

async function listOllamaModels(baseUrl: string, fetcher: typeof fetch): Promise<string[] | undefined> {
  try {
    const response = await fetcher(new URL("/api/tags", baseUrl), { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return undefined;
    const value: unknown = await response.json();
    if (!isRecord(value) || !Array.isArray(value.models)) return undefined;
    return value.models.flatMap((item) => isRecord(item) && typeof item.name === "string" ? [item.name] : []);
  } catch {
    return undefined;
  }
}

async function testOllamaModel(baseUrl: string, model: string, fetcher: typeof fetch): Promise<void> {
  let response: Response;
  try {
    response = await fetcher(new URL("/api/chat", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with OK." }],
        stream: false,
        options: { num_predict: 1 },
      }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (error) {
    fail(`Could not test Ollama model "${model}": ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) fail(`Ollama model test failed (${response.status}): ${await response.text()}`);
}

async function testOpenAICompatibleModel(
  baseUrl: string,
  model: string,
  apiKey: string | undefined,
  fetcher: typeof fetch,
): Promise<void> {
  let response: Response;
  try {
    response = await fetcher(new URL("chat/completions", ensureTrailingSlash(baseUrl)), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with OK." }],
        max_tokens: 1,
        stream: false,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    fail(`Could not connect to the OpenAI-compatible endpoint: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    fail(`Provider test failed (${response.status}). Check the endpoint, model ID, and credential environment variable, then run \`flux setup\` again.`);
  }
}

function pullOllamaModel(model: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ollama", ["pull", model], { stdio: "inherit", shell: false });
    child.once("error", (error) => reject(new Error(`Could not start Ollama model download: ${error.message}`)));
    child.once("close", (code) => code === 0
      ? resolve()
      : reject(new Error(`Ollama model download exited with code ${code ?? "unknown"}.`)));
  });
}

function validateBaseUrl(input: string, fallback: string): string {
  const value = input.trim() || fallback;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail("Enter a complete HTTP or HTTPS base URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return fail("Provider base URLs must use HTTP or HTTPS.");
  }
  if (url.username || url.password || url.search || url.hash) {
    return fail("Do not put credentials, query parameters, or fragments in a provider URL; use the credential environment-variable setting instead.");
  }
  return url.toString().replace(/\/+$/, "");
}

function requireModelId(input: string, fallback?: string): string {
  const value = input.trim() || fallback || "";
  if (!value || /[\s"'`]/.test(value)) fail("Enter a model ID without spaces or shell-quote characters.");
  return value;
}

function sameModelId(left: string, right: string): boolean {
  const normalize = (value: string) => value.includes(":") ? value : `${value}:latest`;
  return normalize(left) === normalize(right);
}

function isEnvironmentName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(message: string): never {
  throw new Error(message);
}
