import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createProfile } from "@flux/providers";
import { FluxError } from "@flux/shared";
import { openApp, paint, parseArgs, stringFlag } from "../common.ts";

async function ask(question: string, fallback = ""): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(question);
    return answer.trim() || fallback;
  } finally {
    rl.close();
  }
}

export async function authCommand(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const app = await openApp();
  try {
    const name = stringFlag(flags, "name");
    const url = stringFlag(flags, "url") ?? stringFlag(flags, "base-url");
    const models = (stringFlag(flags, "model") ?? "")
      .split(",")
      .map((model) => model.trim())
      .filter(Boolean);
    const env = stringFlag(flags, "env");

    const interactive = !name;
    process.stdout.write(`${paint.bold("FLUX provider setup")}\n`);
    process.stdout.write(
      [
        "FLUX stores non-secret provider metadata in your user config.",
        "API keys are never written by FLUX: point a profile at an environment variable.",
        "Local OpenAI-compatible gateways (Ollama, LM Studio, LiteLLM/OmniRoute) usually need no key.",
        "",
      ].join("\n"),
    );

    const displayName = name ?? (await ask("Profile name (for example BharatCode): "));
    if (!displayName) throw new FluxError("config", "A profile name is required.");
    const baseURL =
      url ??
      (await ask("Base URL (for example https://api.example.com/v1): ", "http://127.0.0.1:11434/v1"));
    const modelList =
      models.length > 0
        ? models
        : (await ask("Model id(s), comma separated: "))
            .split(",")
            .map((model) => model.trim())
            .filter(Boolean);
    if (modelList.length === 0) throw new FluxError("config", "At least one model id is required.");
    const envVar =
      env ??
      (interactive
        ? await ask("API key environment variable name (leave blank for none): ")
        : undefined);

    let parsedURL: URL;
    try {
      parsedURL = new URL(baseURL);
    } catch {
      throw new FluxError("config", `Invalid base URL: ${baseURL}`);
    }
    if (!["http:", "https:"].includes(parsedURL.protocol)) {
      throw new FluxError("config", "Base URL must use http or https.");
    }

    const profile = createProfile({
      displayName,
      baseURL: parsedURL.toString().replace(/\/+$/, ""),
      credentialRef: envVar ? `env:${envVar}` : undefined,
      models: modelList,
      defaultModelId: modelList[0],
    });
    app.registry.upsert(profile);
    if (!app.config.defaultModel) {
      app.registry.setDefaultModel({ providerProfileId: profile.id, modelId: modelList[0]! });
    }

    process.stdout.write(`\n${paint.green("Saved profile")} ${profile.id}\n`);
    if (envVar) {
      process.stdout.write(
        process.env[envVar]
          ? `Credential reference env:${envVar} is resolvable.\n`
          : paint.yellow(`Set ${envVar} in your shell/IDE environment; it is not set right now.\n`),
      );
    }
    process.stdout.write(`Default model: ${profile.id}/${app.config.defaultModel?.modelId ?? modelList[0]}\n`);

    const shouldTest = interactive
      ? (await ask("\nVerify with ONE minimal request now? [y/N]: ", "n")).toLowerCase().startsWith("y")
      : flags["test"] === true;
    if (shouldTest) {
      if (!app.credentialStatus(profile)) {
        process.stdout.write(paint.red("Cannot test: the credential environment variable is not set.\n"));
        process.exitCode = 1;
      } else {
        const result = await app.testProvider(profile.id);
        const mark = result.ok ? paint.green("PASS") : paint.red("FAIL");
        process.stdout.write(`${mark} ${result.message} (${result.latencyMs}ms)\n`);
        if (!result.ok) process.exitCode = 1;
      }
    } else {
      process.stdout.write(paint.dim("Skipped live test. Run `flux providers test <id>` when you are ready.\n"));
    }
    process.stdout.write(`\nNext: flux doctor  |  flux  (launch the TUI)\n`);
  } finally {
    app.close();
  }
}
