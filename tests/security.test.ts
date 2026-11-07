import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isSecretPath, normalizeRelative, resolveInsideWorkspace } from "@flux/repository";
import { isDestructiveCommand, PermissionPolicy } from "@flux/permissions";

async function workspace(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "flux-sec-"));
}

describe("workspace path safety", () => {
  test("normalizes workspace-relative paths", () => {
    expect(normalizeRelative(undefined)).toBe("");
    expect(normalizeRelative("./src//a.ts")).toBe("src/a.ts");
    expect(normalizeRelative("src\\lib\\b.ts")).toBe("src/lib/b.ts");
  });

  test("rejects traversal segments", () => {
    expect(() => normalizeRelative("../outside.txt")).toThrow(/escapes the workspace/);
    expect(() => normalizeRelative("src/../../outside.txt")).toThrow(/escapes the workspace/);
  });

  test("rejects absolute paths outside the workspace", async () => {
    const root = await workspace();
    try {
      const outside = process.platform === "win32" ? "C:\\Windows\\win.ini" : "/etc/passwd";
      await expect(resolveInsideWorkspace(root, outside)).rejects.toMatchObject({ category: "path-denied" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("denies credential-like files by default", async () => {
    const root = await workspace();
    try {
      await writeFile(path.join(root, ".env"), "SECRET=1");
      await mkdir(path.join(root, ".ssh"));
      await writeFile(path.join(root, ".ssh", "id_rsa"), "key");
      await writeFile(path.join(root, "config.json"), "{}");

      expect(isSecretPath(".env")).toBe(true);
      expect(isSecretPath(".ssh/id_rsa")).toBe(true);
      expect(isSecretPath("src/config.ts")).toBe(false);

      await expect(resolveInsideWorkspace(root, ".env")).rejects.toMatchObject({ category: "path-denied" });
      await expect(resolveInsideWorkspace(root, ".ssh/id_rsa")).rejects.toMatchObject({
        category: "path-denied",
      });

      const allowed = await resolveInsideWorkspace(root, ".env", { allowSecret: true });
      expect(allowed.exists).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("denies a symlink whose target is outside the workspace", async () => {
    const root = await workspace();
    const outside = await mkdtemp(path.join(tmpdir(), "flux-outside-"));
    try {
      const target = path.join(outside, "secret.txt");
      await writeFile(target, "outside");
      const link = path.join(root, "link.txt");
      try {
        await symlink(target, link, "file");
      } catch {
        // Symlink creation can require elevation on Windows; skip in that case.
        return;
      }
      await expect(resolveInsideWorkspace(root, "link.txt")).rejects.toMatchObject({ category: "path-denied" });
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe("permission policy", () => {
  const request = (kind: "read" | "write" | "shell" | "git-read" | "git-write", command?: string) => ({
    kind,
    tool: "test",
    command,
  });

  test("allows reads in every mode", () => {
    for (const mode of ["ask", "read-only", "accept-edits"] as const) {
      const policy = new PermissionPolicy({ mode });
      expect(policy.evaluate(request("read")).decision).toBe("allow");
      expect(policy.evaluate(request("git-read")).decision).toBe("allow");
    }
  });

  test("asks for writes in ask mode and denies them in read-only mode", () => {
    expect(new PermissionPolicy({ mode: "ask" }).evaluate(request("write")).decision).toBe("ask");
    expect(new PermissionPolicy({ mode: "read-only" }).evaluate(request("write")).decision).toBe("deny");
    expect(new PermissionPolicy({ mode: "accept-edits" }).evaluate(request("write")).decision).toBe("allow");
  });

  test("asks for shell commands unless trusted or accept-edits", () => {
    const ask = new PermissionPolicy({ mode: "ask" });
    expect(ask.evaluate(request("shell", "npm test")).decision).toBe("ask");

    ask.trustCommand("npm test");
    expect(ask.evaluate(request("shell", "npm test")).decision).toBe("allow");
    expect(ask.evaluate(request("shell", "npm test -- --watch")).decision).toBe("ask");

    expect(new PermissionPolicy({ mode: "accept-edits" }).evaluate(request("shell", "npm test")).decision).toBe(
      "allow",
    );
  });

  test("always denies destructive commands, even when trusted or accept-edits", () => {
    const policy = new PermissionPolicy({ mode: "accept-edits" });
    policy.trustCommand("git reset --hard HEAD~1");
    const result = policy.evaluate(request("shell", "git reset --hard HEAD~1"));
    expect(result).toMatchObject({ decision: "deny", code: "destructive-command" });

    expect(isDestructiveCommand("git clean -fdx")).toBe(true);
    expect(isDestructiveCommand("git push origin main --force")).toBe(true);
    expect(isDestructiveCommand("git push origin main -f")).toBe(true);
    expect(isDestructiveCommand("rm -rf /")).toBe(true);
    expect(isDestructiveCommand("npm test")).toBe(false);
  });
});
