import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
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
});
