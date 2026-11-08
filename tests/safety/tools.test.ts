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
    await expect(writeTool(workspace, policy, { path: "file.txt", content: "x" }))
      .rejects.toThrow("FLUX denied approval for write; the operation was not executed.");
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

  test("preserves CRLF and missing final newlines when patching", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flux-"));
    const workspace = new Workspace(root);
    const policy = new ApprovalPolicy({ allowWrites: true });
    const file = path.join(root, "windows.txt");
    await writeFile(file, "alpha\r\nbeta\r\n");

    await patchTool(workspace, policy, {
      path: "windows.txt",
      content: "@@ -1,2 +1,2 @@\r\n alpha\r\n-beta\r\n+gamma\r\n",
    });
    expect(await readFile(file, "utf8")).toBe("alpha\r\ngamma\r\n");

    await writeFile(file, "before");
    await patchTool(workspace, policy, {
      path: "windows.txt",
      content: "@@ -1 +1 @@\n-before\n+after\n\\ No newline at end of file",
    });
    expect(await readFile(file, "utf8")).toBe("after");

    await writeFile(file, "");
    await patchTool(workspace, policy, {
      path: "windows.txt",
      content: "@@ -0,0 +1 @@\n+created",
    });
    expect(await readFile(file, "utf8")).toBe("created\n");
  });

  test("rejects mismatched or partially valid hunks without changing the file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flux-"));
    const workspace = new Workspace(root);
    const policy = new ApprovalPolicy({ allowWrites: true });
    const file = path.join(root, "file.txt");
    const original = "one\ntwo\nthree\n";
    await writeFile(file, original);

    await expect(patchTool(workspace, policy, {
      path: "file.txt",
      content: "@@ -1 +1 @@\n-one\n+ONE\n@@ -3 +3 @@\n-missing\n+THREE",
    })).rejects.toThrow("Patch removal does not match");
    expect(await readFile(file, "utf8")).toBe(original);

    await expect(patchTool(workspace, policy, {
      path: "file.txt",
      content: "@@ -1,2 +1,1 @@\n-one\n+ONE",
    })).rejects.toThrow("Patch hunk line counts do not match");
    expect(await readFile(file, "utf8")).toBe(original);

    await writeFile(file, "repeat\nmiddle\nrepeat\n");
    await expect(patchTool(workspace, policy, {
      path: "file.txt",
      content: "@@ -2 +2 @@\n-repeat\n+changed",
    })).rejects.toThrow("Patch removal does not match");
    expect(await readFile(file, "utf8")).toBe("repeat\nmiddle\nrepeat\n");

    await writeFile(file, original);
    await expect(patchTool(workspace, policy, {
      path: "file.txt",
      content: "@@ -1 +1 @@\n-one\n+one",
    })).rejects.toThrow("Patch produces no changes");
    expect(await readFile(file, "utf8")).toBe(original);
  });

  test("rejects invalid and no-op patches with useful errors", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flux-"));
    const workspace = new Workspace(root);
    const policy = new ApprovalPolicy({ allowWrites: true });
    await writeFile(path.join(root, "file.txt"), "same\n");

    await expect(patchTool(workspace, policy, {
      path: "file.txt",
      content: "@@ -1,1 +1,1 @@\n same",
    })).rejects.toThrow("Patch must contain a change");
    await expect(patchTool(workspace, policy, {
      path: "file.txt",
      content: "@@ invalid",
    })).rejects.toThrow("Invalid unified patch hunk");
  });
});
