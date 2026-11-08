import assert from "node:assert/strict";
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../../src/config/providers.js";
import { createProviderRegistry, describeInferenceRoute, listOllamaModelIds } from "../../src/providers/router.js";
import { createFluxResourceLoader } from "../../src/agent/system-prompt.js";

const config = await loadConfig();
const modelIds = await listOllamaModelIds(config);
if (!modelIds) throw new Error("Cannot reach the configured Ollama endpoint.");
const qwenModelIds = modelIds.filter((modelId) => /qwen/i.test(modelId)).sort();
if (qwenModelIds.length < 2) throw new Error("Install at least two Qwen models to run the live model-switch test.");

const runtime = await ModelRuntime.create({ refreshOnCreate: false });
for (const provider of createProviderRegistry(config, { ollamaModelIds: modelIds }).getProviders()) {
  runtime.registerNativeProvider(provider);
}
const firstModel = runtime.getModel("ollama", qwenModelIds[0]!);
const secondModel = runtime.getModel("ollama", qwenModelIds[1]!);
if (!firstModel || !secondModel) throw new Error("FLUX did not register the discovered Qwen models.");

const cwd = process.cwd();
let activeModel = { provider: firstModel.provider, id: firstModel.id };
const resourceLoader = await createFluxResourceLoader({
  cwd,
  platform: process.platform,
  approvalMode: "unavailable",
  applicationSurface: "terminal CLI",
  getActiveModel: () => activeModel,
  describeInferenceRoute: (model) => describeInferenceRoute(config, model, modelIds),
});
const { session } = await createAgentSession({
  cwd,
  modelRuntime: runtime,
  model: firstModel,
  sessionManager: SessionManager.inMemory(cwd),
  resourceLoader,
  noTools: "all",
});

try {
  for (const model of [firstModel, secondModel, firstModel]) {
    if (session.model?.id !== model.id) await session.setModel(model);
    activeModel = { provider: model.provider, id: model.id };
    let response = "";
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        response += event.assistantMessageEvent.delta;
      }
    });
    await session.prompt("Reply with one brief sentence confirming the request.");
    unsubscribe();
    assert.equal(session.model?.id, model.id, "The selected model must remain active after the request.");
    assert.ok(response.trim(), `The live ${model.provider}/${model.id} request returned no text.`);
    process.stdout.write(`${model.provider}/${model.id}: ${response.trim()}\n`);
  }
} finally {
  session.dispose();
}
