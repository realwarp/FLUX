import { createProfile, type ProviderRegistry } from "@flux/providers";
import { FluxError, parseConfig } from "@flux/shared";
import { boolFlag, openApp, paint, parseArgs, stringFlag, table } from "../common.ts";

function printProviders(app: Awaited<ReturnType<typeof openApp>>): void {
  const config = app.config;
  if (config.providers.length === 0) {
    process.stdout.write("No provider profiles configured. Run `flux auth` or `flux providers add`.\n");
    return;
  }
  const rows = [["ID", "NAME", "URL", "MODELS", "CREDENTIAL", "DEFAULT", "STATUS"]];
  for (const profile of config.providers) {
    const isDefault = config.defaultModel?.providerProfileId === profile.id;
    const credential = profile.credentialRef ?? "none";
    rows.push([
      profile.id,
      profile.displayName,
      profile.baseURL,
      profile.models.join(", ") || "-",
      app.credentialStatus(profile) ? credential : `${credential} (missing)`,
      isDefault ? `${config.defaultModel?.modelId}` : "",
      profile.enabled ? "enabled" : "disabled",
    ]);
  }
  process.stdout.write(`${table(rows)}\n`);
  process.stdout.write(
    `\nMode: ${config.ui.permissionMode ?? "ask"} | Fallback: ${config.fallback.enabled ? "enabled" : "disabled"}\n`,
  );
}

function validateAdd(input: {
  id?: string;
  name: string;
  url: string;
  models: string[];
  env?: string;
}): void {
  let parsedURL: URL;
  try {
    parsedURL = new URL(input.url);
  } catch {
    throw new FluxError("config", `Invalid base URL: ${input.url}`);
  }
  if (!["http:", "https:"].includes(parsedURL.protocol)) {
    throw new FluxError("config", "Base URL must use http or https.");
  }
  if (input.env && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.env)) {
    throw new FluxError("config", "Credential environment variable name is invalid.");
  }
  if (input.models.length === 0) {
    throw new FluxError("config", "At least one model id is required.");
  }
}

async function addProvider(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const url = stringFlag(flags, "url") ?? stringFlag(flags, "base-url");
  const models = (stringFlag(flags, "model") ?? stringFlag(flags, "models") ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  const name = stringFlag(flags, "name");
  const env = stringFlag(flags, "env");
  if (!url || !name) {
    throw new FluxError(
      "config",
      "Usage: flux providers add --name <name> --url <baseURL> --model <model[,model]> [--env API_KEY_VAR] [--id id]",
    );
  }
  validateAdd({ id: stringFlag(flags, "id"), name, url, models, env });

  const app = await openApp();
  try {
    const profile = createProfile({
      id: stringFlag(flags, "id"),
      displayName: name,
      baseURL: url,
      credentialRef: env ? `env:${env}` : undefined,
      models,
      defaultModelId: models[0],
    });
    parseConfig({
      ...app.config,
      providers: [
        ...app.config.providers.filter((candidate) => candidate.id !== profile.id),
        { ...profile, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ],
    });
    app.registry.upsert(profile);
    if (!app.config.defaultModel) {
      app.registry.setDefaultModel({ providerProfileId: profile.id, modelId: models[0]! });
      process.stdout.write(`Default model set to ${profile.id}/${models[0]}.\n`);
    }
    process.stdout.write(`${paint.green("Added provider")} ${profile.id} (${profile.baseURL})\n`);
    if (env && !process.env[env]) {
      process.stdout.write(
        paint.yellow(`Set ${env} in your environment before using this provider. FLUX stores only the reference.\n`),
      );
    }
    process.stdout.write(`Test it with: flux providers test ${profile.id}\n`);
  } finally {
    app.close();
  }
}

export async function providersCommand(argv: string[]): Promise<void> {
  const { positionals, flags } = parseArgs(argv);
  const action = positionals[0] ?? "list";

  if (action === "add") {
    await addProvider(argv.slice(1));
    return;
  }

  const app = await openApp();
  try {
    if (action === "list") {
      printProviders(app);
      return;
    }

    const id = positionals[1];
    if (!id) throw new FluxError("config", `Usage: flux providers ${action} <provider-id>`);
    const registry: ProviderRegistry = app.registry;

    if (action === "test") {
      const model = stringFlag(flags, "model") ?? positionals[2];
      const profile = registry.get(id);
      if (!app.credentialStatus(profile)) {
        throw new FluxError("provider-auth", `Credential reference ${profile.credentialRef} is not resolvable in this shell.`);
      }
      process.stdout.write(`Testing ${id}${model ? ` / ${model}` : ""} with one minimal request...\n`);
      const result = await app.testProvider(id, model);
      const mark = result.ok ? paint.green("PASS") : paint.red("FAIL");
      process.stdout.write(`${mark} ${id}: ${result.message} (${result.latencyMs}ms)\n`);
      if (result.models.length > 0) process.stdout.write(paint.dim(`Endpoint models: ${result.models.join(", ")}\n`));
      if (!result.ok) process.exitCode = 1;
      return;
    }

    if (action === "enable" || action === "disable") {
      registry.setEnabled(id, action === "enable");
      process.stdout.write(`${action === "enable" ? "Enabled" : "Disabled"} ${id}.\n`);
      return;
    }

    if (action === "remove" || action === "rm") {
      registry.remove(id);
      process.stdout.write(`Removed ${id}.\n`);
      return;
    }

    if (action === "default") {
      const model = positionals[2];
      if (!model) throw new FluxError("config", "Usage: flux providers default <provider-id> <model>");
      const profile = registry.get(id);
      if (!profile.models.includes(model)) {
        process.stdout.write(paint.yellow(`Note: ${model} is not in the profile's recorded model list.\n`));
      }
      registry.setDefaultModel({ providerProfileId: id, modelId: model });
      process.stdout.write(`Default model: ${id}/${model}\n`);
      return;
    }

    if (action === "models") {
      const models = await app.listProviderModels(id);
      process.stdout.write(models.length > 0 ? `${models.join("\n")}\n` : "Endpoint listed no models.\n");
      return;
    }

    throw new FluxError("config", `Unknown providers action: ${action}. Try list, add, test, enable, disable, remove, models.`);
  } finally {
    app.close();
  }
}
