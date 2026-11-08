import { mkdtemp, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { LocalJsonStore } from "../../src/persistence/local-store.js";
import { SessionStore } from "../../src/sessions/records.js";

describe("session evidence persistence", () => {
  test("recovers messages, approvals, and verification records", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "flux-session-"));
    const store = new SessionStore("session-test", directory, directory);
    await store.appendMessage({ role: "user", content: "inspect" });
    await store.recordApproval({
      sessionId: store.id,
      action: "mutation tools",
      decision: "approved",
    });
    await store.recordVerification({
      sessionId: store.id,
      command: "npm test",
      passed: true,
      output: "2 passed",
    });

    const recovered = await new SessionStore("session-test", directory, directory).load();
    expect(recovered.messages).toHaveLength(1);
    expect(recovered.approvals[0]?.decision).toBe("approved");
    expect(recovered.verifications[0]?.passed).toBe(true);
  });

  test("writes concurrent records atomically with private POSIX permissions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flux-private-records-"));
    const directory = path.join(root, "records");
    const file = path.join(directory, "state.json");
    const store = new LocalJsonStore(file, { value: -1 });
    await Promise.all(Array.from({ length: 8 }, (_, value) => store.write({ value })));
    const records = new SessionStore("concurrent-session", root, root);
    await Promise.all(Array.from({ length: 8 }, (_, index) =>
      records.appendMessage({ role: "user", content: `message ${index}` }),
    ));

    const saved = await store.read();
    const session = await records.load();
    expect(saved.value).toBeGreaterThanOrEqual(0);
    expect(saved.value).toBeLessThan(8);
    expect(session.messages).toHaveLength(8);
    if (process.platform !== "win32") {
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
      expect((await stat(file)).mode & 0o777).toBe(0o600);
    }
  });
});
