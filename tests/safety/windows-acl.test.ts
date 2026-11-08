import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { SessionStore } from "../../src/sessions/records.js";
import { ApprovalPolicy } from "../../src/safety/approval.js";
import { createWorkspace } from "../../src/safety/workspace.js";
import { patchTool } from "../../src/tools/patch.js";
import { writeTool } from "../../src/tools/write.js";

describe("Windows filesystem ACL enforcement", () => {
  test.skipIf(process.platform !== "win32")("OS write denial is not bypassed by automatic approval and leaves files unchanged", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flux-acl-"));
    const restricted = path.join(root, "restricted");
    const existingFile = path.join(restricted, "existing.txt");
    await mkdir(restricted);
    await writeFile(existingFile, "original\r\ncontent\r\n");
    const records = new SessionStore("acl-session", restricted, restricted);
    await records.appendMessage({ role: "user", content: "persisted before ACL restriction" });
    const sessionFile = path.join(restricted, "sessions", "acl-session.json");
    const aclBackup = path.join(root, "restricted-acl-backup.txt");
    runIcacls([restricted, "/save", aclBackup, "/T"]);
    const identity = execFileSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8" });
    const sid = identity.match(/S-\d-(?:\d+-?)+/)?.[0];
    if (!sid) throw new Error("Could not determine the current Windows user SID.");
    const originalDirectoryAcl = runIcacls([restricted]);
    const originalFileAcl = runIcacls([existingFile]);
    const originalSessionAcl = runIcacls([sessionFile]);
    const originalSessionData = await readFile(sessionFile, "utf8");
    let restrictedAclApplied = false;
    try {
      restrictedAclApplied = true;
      runIcacls([restricted, "/deny", `*${sid}:(OI)(CI)(WD,AD)`]);

      const workspace = createWorkspace(restricted);
      const automaticApproval = new ApprovalPolicy({ allowWrites: true });
      const sessionError = await records.appendMessage({ role: "assistant", content: "must not be persisted" }).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(sessionError).toBeInstanceOf(Error);
      expect(["EACCES", "EPERM"]).toContain(errorCode(sessionError));
      expect(await readFile(sessionFile, "utf8")).toBe(originalSessionData);
      expect(await readdir(path.join(restricted, "sessions"))).toEqual(["acl-session.json"]);

      const writeError = await writeTool(workspace, automaticApproval, {
        path: "new.txt",
        content: "must not be created",
      }).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(writeError).toBeInstanceOf(Error);
      expect(["EACCES", "EPERM"]).toContain(errorCode(writeError));
      await expect(readFile(path.join(restricted, "new.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });

      const patchError = await patchTool(workspace, automaticApproval, {
        path: "existing.txt",
        content: "@@ -1,2 +1,2 @@\n original\n-content\n+modified",
      }).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(patchError).toBeInstanceOf(Error);
      expect(["EACCES", "EPERM"]).toContain(errorCode(patchError));
      expect(await readFile(existingFile, "utf8")).toBe("original\r\ncontent\r\n");
      expect(await readdir(restricted)).toEqual(["existing.txt", "sessions"]);
    } finally {
      try {
        if (restrictedAclApplied) {
          // /deny replaces matching explicit grants. Restore the saved DACLs
          // instead of assuming /remove:d reconstructs the original ACL exactly.
          runIcacls([root, "/restore", aclBackup]);
          const restoredAcls = [runIcacls([restricted]), runIcacls([existingFile]), runIcacls([sessionFile])];
          for (const acl of restoredAcls) expect(acl).not.toMatch(/\\(DENY\\)/i);
          const restoredFile = path.join(restricted, "restored-check.txt");
          await writeFile(restoredFile, "restored");
          expect(await readFile(restoredFile, "utf8")).toBe("restored");
          await writeFile(existingFile, "restored existing file");
          expect(await readFile(existingFile, "utf8")).toBe("restored existing file");
          const restoredSessionFile = path.join(path.dirname(sessionFile), "restored-session-check.txt");
          await writeFile(restoredSessionFile, "restored");
          expect(await readFile(restoredSessionFile, "utf8")).toBe("restored");
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });
});

function runIcacls(args: string[]): string {
  return execFileSync("icacls.exe", args, { encoding: "utf8", windowsHide: true });
}


function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}
