import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { loadConfig, saveConfig } from "../../src/config/providers.js";
import { runProviderSetup, type SetupPrompter } from "../../src/config/setup.js";
import {
  createProviderRegistry,
  describeInferenceRoute,
  getConfiguredModelReadiness,
} from "../../src/providers/router.js";

describe("Pi provider routing", () => {
  test("stores credential references without persisting secret values", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flux-config-"));
    const file = path.join(root, "config.json");
    const oldEnv = {
      FLUX_PROVIDER: process.env.FLUX_PROVIDER,
      FLUX_MODEL: process.env.FLUX_MODEL,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      FLUX_TEST_CREDENTIAL: process.env.FLUX_TEST_CREDENTIAL,
    };
    try {
      process.env.FLUX_PROVIDER = "openai-compatible";
      delete process.env.FLUX_MODEL;
      delete process.env.OPENAI_API_KEY;
      process.env.FLUX_TEST_CREDENTIAL = "test-secret-value";
      await saveConfig({
        defaultProvider: "openai-compatible",
        defaultModel: "test-model",
        providers: {
          "openai-compatible": {
            name: "openai-compatible",
            model: "test-model",
            baseUrl: "https://example.test/v1",
            enabled: true,
            credentialEnv: "FLUX_TEST_CREDENTIAL",
            apiKey: "test-secret-value",
          },
        },
      }, file);

      const saved = await readFile(file, "utf8");
      expect(saved).toContain("FLUX_TEST_CREDENTIAL");
      expect(saved).not.toContain("test-secret-value");
      const loaded = await loadConfig(file);
      expect(loaded.providers["openai-compatible"]?.apiKey).toBe("test-secret-value");
    } finally {
      restoreEnvironment("FLUX_PROVIDER", oldEnv.FLUX_PROVIDER);
      restoreEnvironment("FLUX_MODEL", oldEnv.FLUX_MODEL);
      restoreEnvironment("OPENAI_API_KEY", oldEnv.OPENAI_API_KEY);
      restoreEnvironment("FLUX_TEST_CREDENTIAL", oldEnv.FLUX_TEST_CREDENTIAL);
      await rm(root, { recursive: true, force: true });
    }
  });

  test("guides OpenAI-compatible setup and tests the selected model before saving", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flux-setup-"));
    const file = path.join(root, "config.json");
    const oldCredential = process.env.FLUX_SETUP_TEST_KEY;
    process.env.FLUX_SETUP_TEST_KEY = "setup-secret";
    const answers = ["2", "https://provider.example/v1", "Example provider", "example-model", "FLUX_SETUP_TEST_KEY"];
    const prompts: string[] = [];
    const output: string[] = [];
    const terminal: SetupPrompter = {
      ask: async (question) => {
        prompts.push(question);
        const answer = answers.shift();
        if (answer === undefined) throw new Error("Unexpected setup question");
        return answer;
      },
      write: (message) => output.push(message),
    };
    const requests: Array<{ url: string; authorization?: string; body: string }> = [];
    try {
      const config = await runProviderSetup(undefined, terminal, async (input, init) => {
        requests.push({
          url: String(input),
          authorization: new Headers(init?.headers).get("authorization") ?? undefined,
          body: String(init?.body ?? ""),
        });
        return Response.json({ choices: [{ message: { content: "OK" } }] });
      }, file);

      expect(config.defaultProvider).toBe("openai-compatible");
      expect(config.defaultModel).toBe("example-model");
      expect(config.providers["openai-compatible"]?.displayName).toBe("Example provider");
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe("https://provider.example/v1/chat/completions");
      expect(requests[0]?.authorization).toBe("Bearer setup-secret");
      expect(requests[0]?.body).toContain("example-model");
      const saved = await readFile(file, "utf8");
      expect(saved).toContain("FLUX_SETUP_TEST_KEY");
      expect(saved).not.toContain("setup-secret");
      expect(prompts).toHaveLength(5);
      expect(output.join("")).toContain("FLUX is ready");
    } finally {
      restoreEnvironment("FLUX_SETUP_TEST_KEY", oldCredential);
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects provider URLs that could persist credentials or query secrets", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flux-setup-url-secret-"));
    const file = path.join(root, "config.json");
    try {
      for (const baseUrl of [
        "https://user:secret@provider.example/v1",
        "https://provider.example/v1?api_key=secret",
      ]) {
        const answers = ["2", baseUrl];
        const terminal: SetupPrompter = {
          ask: async () => {
            const answer = answers.shift();
            if (answer === undefined) throw new Error("Unexpected setup question");
            return answer;
          },
          write: () => undefined,
        };
        await expect(runProviderSetup(undefined, terminal, async () => {
          throw new Error("URL validation should happen before a request");
        }, file)).rejects.toThrow("Do not put credentials");
      }

      await expect(saveConfig({
        defaultProvider: "openai-compatible",
        defaultModel: "example",
        providers: {
          "openai-compatible": {
            name: "openai-compatible",
            model: "example",
            baseUrl: "https://provider.example/v1?token=secret",
            enabled: true,
          },
        },
      }, file)).rejects.toThrow("cannot contain credentials");
      await expect(readFile(file, "utf8")).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("does not download an Ollama model without explicit confirmation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flux-setup-cancel-"));
    const file = path.join(root, "config.json");
    const answers = ["1", "http://127.0.0.1:11434/v1", "model:tag", "no"];
    const terminal: SetupPrompter = {
      ask: async () => {
        const answer = answers.shift();
        if (answer === undefined) throw new Error("Unexpected setup question");
        return answer;
      },
      write: () => undefined,
    };
    try {
      await expect(runProviderSetup(undefined, terminal, async () =>
        Response.json({ models: [] }), file)).rejects.toThrow("no model was downloaded");
      await expect(readFile(file, "utf8")).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("registers configured local and compatible providers", () => {
    const models = createProviderRegistry({
      providers: {
        ollama: {
          name: "ollama",
          model: "qwen35-9b-20k:latest",
          baseUrl: "http://127.0.0.1:11434/v1",
          enabled: true,
        },
        "openai-compatible": {
          name: "openai-compatible",
          model: "gpt-test",
          baseUrl: "http://127.0.0.1:8000/v1",
          enabled: true,
        },
      },
    });

    expect(models.getModel("ollama", "qwen35-9b-20k:latest")?.baseUrl).toBe("http://127.0.0.1:11434/v1");
    expect(models.getModel("openai-compatible", "gpt-test")?.api).toBe("openai-completions");
  });

  test("reports Ollama model readiness without substituting a different model", () => {
    const config = {
      providers: {
        ollama: {
          name: "ollama" as const,
          model: "qwen35-9b-20k",
          baseUrl: "http://127.0.0.1:11434/v1",
          enabled: true,
        },
      },
    };

    expect(getConfiguredModelReadiness(config, "ollama", "qwen35-9b-20k", ["qwen35-9b-20k:latest"]))
      .toEqual({ status: "ready" });
    const missing = getConfiguredModelReadiness(config, "ollama", "llama3.2", ["qwen35-9b-20k:latest"]);
    expect(missing.status).toBe("missing");
    expect(missing.message).toContain("ollama pull llama3.2");
    expect(missing.message).toContain("will not silently substitute");

    const unverified = getConfiguredModelReadiness(config, "ollama", "llama3.2");
    expect(unverified.status).toBe("unverified");
    expect(unverified.message).toContain("Start Ollama");
    expect(unverified.message).toContain("will not silently substitute");
  });

  test("reports endpoint evidence without claiming where inference executes", () => {
    const config = {
      providers: {
        ollama: {
          name: "ollama" as const,
          model: "qwen",
          baseUrl: "http://127.0.0.1:11434/v1",
          enabled: true,
        },
        "openai-compatible": {
          name: "openai-compatible" as const,
          model: "gpt",
          baseUrl: "https://api.example.test/v1",
          enabled: true,
        },
      },
    };

    const localRoute = describeInferenceRoute(config, { provider: "ollama", id: "qwen" }, ["qwen:latest"]);
    expect(localRoute).toContain("configured loopback endpoint");
    expect(localRoute).toContain("does not verify whether Ollama forwards inference elsewhere");
    expect(localRoute).not.toContain("inference runs locally");

    const remoteRoute = describeInferenceRoute(config, { provider: "openai-compatible", id: "gpt" });
    expect(remoteRoute).toContain("configured non-loopback endpoint");
    expect(remoteRoute).toContain("cannot verify where that provider executes inference");
    expect(remoteRoute).not.toContain("inference runs remotely");
  });
});

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
