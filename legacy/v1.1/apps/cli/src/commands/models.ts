import { AGENT_ROLES, FluxError, type AgentRole } from "@flux/shared";
import { boolFlag, openApp, paint, parseArgs, stringFlag, table } from "../common.ts";

function formatChain(chain: Array<{ providerProfileId: string; modelId: string }>): string {
  return chain.length > 0 ? chain.map((ref) => `${ref.providerProfileId}/${ref.modelId}`).join(" → ") : "empty";
}

export async function modelsCommand(argv: string[]): Promise<void> {
  const { positionals, flags } = parseArgs(argv);
  const action = positionals[0] ?? "list";
  const app = await openApp();
  try {
    const config = app.config;

    if (action === "list") {
      const rows = [["PROVIDER", "MODEL", "STREAM", "TOOLS", "USAGE", "DEFAULT", "ROLES"]];
      for (const profile of config.providers) {
        for (const model of profile.models) {
          const caps = profile.capabilities?.[model];
          const roles = AGENT_ROLES.filter(
            (role) =>
              config.roles[role]?.providerProfileId === profile.id && config.roles[role]?.modelId === model,
          );
          rows.push([
            profile.id,
            model,
            caps?.streaming ?? "unknown",
            caps?.toolCalls ?? "unknown",
            caps?.usageReporting ?? "unknown",
            config.defaultModel?.providerProfileId === profile.id && config.defaultModel?.modelId === model ? "yes" : "",
            roles.join(","),
          ]);
        }
      }
      if (rows.length === 1) {
        process.stdout.write("No models configured. Run `flux auth` or `flux providers add`.\n");
      } else {
        process.stdout.write(`${table(rows)}\n`);
        process.stdout.write(paint.dim("\nCapabilities marked unknown are not assumed; run `flux providers test <id>` to verify.\n"));
      }
      return;
    }

    if (action === "use") {
      const providerId = positionals[1];
      const modelId = positionals[2];
      if (!providerId || !modelId) throw new FluxError("config", "Usage: flux models use <provider-id> <model-id>");
      app.registry.get(providerId);
      app.registry.setDefaultModel({ providerProfileId: providerId, modelId });
      process.stdout.write(`Default model: ${providerId}/${modelId}\n`);
      return;
    }

    if (action === "role") {
      const role = positionals[1] as AgentRole | undefined;
      if (!role || !AGENT_ROLES.includes(role)) {
        throw new FluxError("config", `Usage: flux models role <${AGENT_ROLES.join("|")}> <provider-id> <model-id> [--clear]`);
      }
      if (boolFlag(flags, "clear") || positionals[2] === "clear") {
        app.registry.setRoleModel(role, undefined);
        process.stdout.write(`${role} inherits the default model.\n`);
        return;
      }
      const providerId = positionals[2];
      const modelId = positionals[3];
      if (!providerId || !modelId) {
        throw new FluxError("config", "Usage: flux models role <role> <provider-id> <model-id> [--clear]");
      }
      app.registry.get(providerId);
      app.registry.setRoleModel(role, { providerProfileId: providerId, modelId });
      process.stdout.write(`${role} model: ${providerId}/${modelId}\n`);
      return;
    }

    if (action === "fallback") {
      const sub = positionals[1] ?? "list";
      const roleFlag = stringFlag(flags, "role");
      if (roleFlag && !AGENT_ROLES.includes(roleFlag as AgentRole)) {
        throw new FluxError("config", `Unknown role: ${roleFlag}. Use one of: ${AGENT_ROLES.join(", ")}`);
      }
      const role = roleFlag as AgentRole | undefined;

      if (sub === "list") {
        const fallback = config.fallback;
        process.stdout.write(`Fallback: ${fallback.enabled ? paint.green("enabled") : "disabled (opt-in)"}\n`);
        process.stdout.write(`Global chain: ${formatChain(fallback.chain)}\n`);
        for (const [name, chain] of Object.entries(fallback.perRole ?? {})) {
          if (chain && chain.length > 0) process.stdout.write(`${name} chain: ${formatChain(chain)}\n`);
        }
        return;
      }
      if (sub === "on" || sub === "off") {
        app.registry.setFallbackEnabled(sub === "on");
        process.stdout.write(`Fallback ${sub === "on" ? "enabled" : "disabled"}.\n`);
        return;
      }
      if (sub === "add") {
        const providerId = positionals[2];
        const modelId = positionals[3];
        if (!providerId || !modelId) {
          throw new FluxError("config", "Usage: flux models fallback add <provider-id> <model-id> [--role <role>]");
        }
        app.registry.addFallback({ providerProfileId: providerId, modelId }, role);
        process.stdout.write(`Added ${providerId}/${modelId} to the ${role ? `${role} ` : ""}fallback chain.\n`);
        return;
      }
      if (sub === "clear") {
        app.registry.clearFallback(role);
        process.stdout.write(`Cleared the ${role ? `${role} ` : "global "}fallback chain.\n`);
        return;
      }
      if (sub === "reset") {
        app.registry.clearFallback(undefined, true);
        process.stdout.write("Cleared all fallback chains and disabled fallback.\n");
        return;
      }
      throw new FluxError("config", "Usage: flux models fallback [list|on|off|add <p> <m> [--role r]|clear [--role r]|reset]");
    }

    throw new FluxError("config", `Unknown models action: ${action}. Try list, use, role, fallback.`);
  } finally {
    app.close();
  }
}
