import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { ApprovalDenied, ApprovalPolicy } from "../../src/safety/approval.js";
import { Workspace, WorkspaceViolation } from "../../src/safety/workspace.js";
import { patchTool } from "../../src/tools/patch.js";
import { readTool } from "../../src/tools/read.js";
import { shellTool } from "../../src/tools/shell.js";
import { writeTool } from "../../src/tools/write.js";

describe("workspace tools", () => {
  test("rejects traversal and symlink escapes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flux-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "flux-outside-"));
    await writeFile(path.join(outside, "secret.txt"), "secret");
    await symlink(outside, path.join(root, "linked"), "junction");
    const workspace = new Workspace(root);
    await expect(readTool(workspace, new ApprovalPolicy(), { path: "../secret.txt" })).rejects.toBeInstanceOf(WorkspaceViolation);
    await expect(readTool(workspace, new ApprovalPolicy(), { path: "linked/secret.txt" })).rejects.toBeInstanceOf(WorkspaceViolation);
  });

  test("requires approval for writes and shell", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flux-"));
    const workspace = new Workspace(root);
    const policy = new ApprovalPolicy();
    await expect(writeTool(workspace, policy, { path: "file.txt", content: "x" })).rejects.toBeInstanceOf(ApprovalDenied);
    await expect(shellTool(workspace, policy, { command: "echo x" })).rejects.toBeInstanceOf(ApprovalDenied);
  });

  test("applies matching patches and bounds shell output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flux-"));
    const workspace = new Workspace(root);
    const policy = new ApprovalPolicy({ allowWrites: true, allowShell: true });
    await writeFile(path.join(root, "file.txt"), "one\ntwo\n");
    await patchTool(workspace, policy, {
      path: "file.txt",
      content: "@@ -1,2 +1,2 @@\n one\n-two\n+changed",
    });
    expect(await readFile(path.join(root, "file.txt"), "utf8")).toBe("one\nchanged\n");
    const result = await shellTool(workspace, policy, { command: "echo 123456789", maxOutputBytes: 4 });
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(4);
  });
});
