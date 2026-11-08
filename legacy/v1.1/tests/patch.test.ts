import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyUnifiedDiff, parseUnifiedDiff } from "@flux/tools";

async function workspace(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "flux-patch-"));
}

describe("unified diff patches", () => {
  test("applies a matching hunk and reports line statistics", async () => {
    const root = await workspace();
    try {
      await writeFile(path.join(root, "file.txt"), "line1\nline2\nline3\n");
      const diff = [
        "--- a/file.txt",
        "+++ b/file.txt",
        "@@ -1,3 +1,3 @@",
        " line1",
        "-line2",
        "+LINE2",
        " line3",
        "",
      ].join("\n");

      const result = await applyUnifiedDiff(root, diff);
      expect(result.files).toEqual([{ path: "file.txt", created: false, added: 1, removed: 1 }]);
      expect(await readFile(path.join(root, "file.txt"), "utf8")).toBe("line1\nLINE2\nline3\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("creates a new file from a patch", async () => {
    const root = await workspace();
    try {
      const diff = ["--- /dev/null", "+++ b/new.txt", "@@ -0,0 +1,2 @@", "+hello", "+world", ""].join("\n");
      const result = await applyUnifiedDiff(root, diff);
      expect(result.files[0]).toMatchObject({ path: "new.txt", created: true, added: 2 });
      expect(await readFile(path.join(root, "new.txt"), "utf8")).toBe("hello\nworld\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("refuses a context mismatch without changing the file", async () => {
    const root = await workspace();
    try {
      const original = "alpha\nbeta\ngamma\n";
      await writeFile(path.join(root, "file.txt"), original);
      const diff = [
        "--- a/file.txt",
        "+++ b/file.txt",
        "@@ -1,3 +1,3 @@",
        " alpha",
        "-WRONG",
        "+BETA",
        " gamma",
        "",
      ].join("\n");

      await expect(applyUnifiedDiff(root, diff)).rejects.toMatchObject({ category: "tool-validation" });
      expect(await readFile(path.join(root, "file.txt"), "utf8")).toBe(original);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects a patch that targets a path outside the workspace", () => {
    const diff = ["--- a/ok.txt", "+++ b/../escape.txt", "@@ -1 +1 @@", "-a", "+b", ""].join("\n");
    expect(() => parseUnifiedDiff(diff)).toThrow(/outside the workspace/);
  });

  test("rejects deletion and empty patches", () => {
    const deletion = ["--- a/file.txt", "+++ /dev/null", "@@ -1 +0,0 @@", "-gone", ""].join("\n");
    expect(() => parseUnifiedDiff(deletion)).toThrow(/no applicable hunks/);
    expect(() => parseUnifiedDiff("not a patch")).toThrow(/no applicable hunks/);
  });
});
