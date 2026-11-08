import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FluxDatabase } from "@flux/persistence";
import { UsageLedger } from "@flux/providers";
import { parseConfig, redactSecrets, type ProviderProfile } from "@flux/shared";

function database(): FluxDatabase {
  return new FluxDatabase(":memory:");
}

function profile(): ProviderProfile {
  return {
    id: "local",
    displayName: "Local",
    protocol: "openai-compatible",
    baseURL: "http://127.0.0.1:11434/v1",
    enabled: true,
    models: ["m"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("SQLite persistence", () => {
  test("creates, resumes and deletes sessions with messages", () => {
    const db = database();
    try {
      const session = db.createSession({ cwd: "C:\\work", title: "Demo" });
      expect(db.schemaVersion()).toBe(1);
      db.createSession({ cwd: "C:\\work", title: "Another session" });
      expect(db.searchSessions("demo").map((item) => item.id)).toEqual([session.id]);

      db.appendMessage({ sessionId: session.id, role: "user", content: "hello", agentId: "agent_1" });
      db.appendMessage({
        sessionId: session.id,
        role: "assistant",
        content: "working",
        toolCalls: [{ id: "call_1", name: "read_file", arguments: "{}" }],
      });
      db.appendMessage({ sessionId: session.id, role: "tool", content: "done", toolCallId: "call_1" });

      const loaded = db.getSession(session.id);
      expect(loaded).toMatchObject({ id: session.id, title: "Demo", cwd: "C:\\work", status: "active" });

      const messages = db.listMessages(session.id);
      expect(messages).toHaveLength(3);
      expect(messages[1]?.toolCalls?.[0]?.name).toBe("read_file");
      expect(messages[2]?.toolCallId).toBe("call_1");

      const reopened = new FluxDatabase(":memory:");
      expect(reopened.listSessions()).toHaveLength(0);
      reopened.close();

      db.deleteSession(session.id);
      expect(db.listSessions()).toHaveLength(1);
      expect(db.listMessages(session.id)).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  test("persists tool calls before dispatch and marks them executed", () => {
    const db = database();
    try {
      const session = db.createSession({ cwd: "." });
      db.beginToolCall({
        id: "call_1",
        sessionId: session.id,
        name: "write_file",
        args: '{"path":"a.ts"}',
      });
      expect(db.getToolCall("call_1")).toMatchObject({ executed: false });

      // A crash/retry must not insert a duplicate row.
      db.beginToolCall({ id: "call_1", sessionId: session.id, name: "write_file", args: "{}" });
      expect(db.getToolCall("call_1")?.arguments).toBe('{"path":"a.ts"}');

      db.finishToolCall("call_1", true, "Wrote a.ts");
      expect(db.getToolCall("call_1")).toMatchObject({ executed: true, ok: true, result: "Wrote a.ts" });
    } finally {
      db.close();
    }
  });

  test("round-trips usage events and verification evidence", () => {
    const db = database();
    try {
      const session = db.createSession({ cwd: "." });
      const ledger = new UsageLedger();
      const event = ledger.record({
        sessionId: session.id,
        taskId: "task_1",
        providerProfileId: "local",
        modelId: "m",
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        source: "provider-reported",
      });
      db.recordUsage(event);
      const usage = db.listUsage(session.id);
      expect(usage).toHaveLength(1);
      expect(usage[0]).toMatchObject({ totalTokens: 15, source: "provider-reported" });

      db.recordVerification({
        id: "ver_1",
        sessionId: session.id,
        taskId: "task_1",
        command: "bun test",
        cwd: "C:\\work",
        exitCode: 1,
        durationMs: 1234,
        output: "3 fail",
        truncated: false,
        status: "failed",
        at: "2026-01-01T00:00:00.000Z",
      });

      const verifications = db.listVerifications(session.id);
      expect(verifications).toHaveLength(1);
      expect(verifications[0]).toMatchObject({
        command: "bun test",
        exitCode: 1,
        status: "failed",
        truncated: false,
      });
    } finally {
      db.close();
    }
  });
});

describe("configuration safety", () => {
  test("accepts env references and rejects raw credentials", () => {
    const base = {
      version: 1,
      providers: [
        {
          ...profile(),
          credentialRef: "env:FLUX_KEY",
        },
      ],
    };
    expect(parseConfig(base).providers[0]?.credentialRef).toBe("env:FLUX_KEY");

    expect(() =>
      parseConfig({
        version: 1,
        providers: [{ ...profile(), credentialRef: "sk-raw-secret-value-123456" }],
      }),
    ).toThrow(/env:VARIABLE_NAME/);
  });

  test("redacts bearer tokens, API keys and assignments", () => {
    const redacted = redactSecrets(
      "Authorization: Bearer abcdefghijklmnop\nkey sk-abcdefghijklmnop\napi_key=supersecretvalue",
    );
    expect(redacted).not.toContain("abcdefghijklmnop");
    expect(redacted).not.toContain("sk-abcdefghijklmnop");
    expect(redacted).not.toContain("supersecretvalue");
    expect(redacted).toContain("[REDACTED");
  });

  test("project config may not define providers", async () => {
    const { ConfigManager } = await import("@flux/app-core");
    const cwd = await mkdtemp(path.join(tmpdir(), "flux-config-"));
    try {
      const { mkdir, writeFile } = await import("node:fs/promises");
      await mkdir(path.join(cwd, ".flux"));
      await writeFile(
        path.join(cwd, ".flux", "config.json"),
        JSON.stringify({ providers: [profile()] }),
        "utf8",
      );
      const paths = {
        home: path.join(cwd, "home"),
        configFile: path.join(cwd, "home", "config.json"),
        dbFile: path.join(cwd, "home", "flux.sqlite"),
      };
      const manager = new ConfigManager(paths, cwd);
      expect(() => manager.load()).toThrow(/must not define providers/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
