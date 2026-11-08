import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../../src/config/providers.js";
import { getConfiguredModelReadiness, listOllamaModelIds } from "../../src/providers/router.js";

const config = await loadConfig();
const providerName = config.defaultProvider ?? "ollama";
const modelId = config.defaultModel ?? config.providers[providerName]?.model;
if (providerName !== "ollama" || !modelId) {
  throw new Error("Set FLUX_PROVIDER=ollama and FLUX_MODEL to an installed Ollama model before running this live test.");
}

const ollamaModelIds = await listOllamaModelIds(config);
const readiness = getConfiguredModelReadiness(config, providerName, modelId, ollamaModelIds);
if (readiness.status !== "ready") throw new Error(readiness.message ?? "The configured Ollama model is not ready.");

const root = await mkdtemp(path.join(os.tmpdir(), "flux-live-runtime-"));
const temporaryWorkspace = path.join(root, "temporary workspace with spaces");
const agentDirectory = path.join(root, "agent-data");
const fluxDataDirectory = path.join(root, "flux-data");
await Promise.all([
  mkdir(temporaryWorkspace),
  mkdir(agentDirectory),
  mkdir(fluxDataDirectory),
]);

try {
  const env = {
    ...process.env,
    FLUX_PROVIDER: providerName,
    FLUX_MODEL: modelId,
    OLLAMA_MODEL: modelId,
    PI_CODING_AGENT_DIR: agentDirectory,
    FLUX_DATA_DIR: fluxDataDirectory,
  };
  for (const cwd of [process.cwd(), temporaryWorkspace]) {
    const output = execFileSync(
      process.execPath,
      [path.join(process.cwd(), "src", "cli.ts"), `--cwd=${cwd}`, "--prompt=Where is my current workspace?"],
      { encoding: "utf8", env },
    );
    assert.ok(
      output.split(/\r?\n/).some((line) => line === `Current workspace: ${cwd}`),
      `FLUX did not preserve the exact configured workspace path: ${cwd}\n${output}`,
    );
    process.stdout.write(`Exact workspace response verified: ${cwd}\n`);
  }
  process.stdout.write(`Configured installed Ollama model: ${providerName}/${modelId}\n`);
  process.stdout.write("No model generation was needed; FLUX answered the workspace query deterministically.\n");
} finally {
  await rm(root, { recursive: true, force: true });
}
