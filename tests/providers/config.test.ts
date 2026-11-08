import { describe, expect, test } from "bun:test";
import { createProviderRegistry } from "../../src/providers/router.js";

describe("Pi provider routing", () => {
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
});
