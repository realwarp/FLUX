import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { FluxError } from "@flux/shared";
import { resolveInsideWorkspace } from "@flux/repository";

export interface PatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface FilePatch {
  oldPath: string;
  newPath: string;
  hunks: PatchHunk[];
}

export interface PatchResult {
  files: Array<{ path: string; created: boolean; added: number; removed: number }>;
}

/**
 * Parse a unified diff (git style). Paths are workspace-relative.
 * Only standard `---/+++/@@` hunks are accepted; binary diffs are rejected.
 */
export function parseUnifiedDiff(diff: string): FilePatch[] {
  const lines = diff.split(/\r?\n/);
  const patches: FilePatch[] = [];
  let current: FilePatch | undefined;
  let hunk: PatchHunk | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.startsWith("diff --git ")) {
      current = { oldPath: "", newPath: "", hunks: [] };
      patches.push(current);
      hunk = undefined;
      continue;
    }
    if (line.startsWith("--- ")) {
      if (!current) {
        current = { oldPath: "", newPath: "", hunks: [] };
        patches.push(current);
      }
      current.oldPath = normalizeDiffPath(line.slice(4));
      hunk = undefined;
      continue;
    }
    if (line.startsWith("+++ ")) {
      if (!current) throw new FluxError("tool-validation", "Malformed patch: +++ without ---.");
      current.newPath = normalizeDiffPath(line.slice(4));
      continue;
    }
    if (line.startsWith("@@")) {
      if (!current) throw new FluxError("tool-validation", "Malformed patch: hunk without file header.");
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!match) throw new FluxError("tool-validation", `Malformed hunk header: ${line}`);
      hunk = {
        oldStart: Number(match[1]),
        oldLines: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]),
        newLines: match[4] === undefined ? 1 : Number(match[4]),
        lines: [],
      };
      current.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith("\\ No newline")) continue;
    if (line === "" && hunk.lines.length === 0) continue;
    const prefix = line[0];
    if (prefix !== " " && prefix !== "+" && prefix !== "-") {
      // Trailing blank line after the final hunk.
      if (line.trim() === "") continue;
      throw new FluxError("tool-validation", `Unexpected patch line: ${line.slice(0, 80)}`);
    }
    hunk.lines.push(line);
  }

  const usable = patches.filter((patch) => patch.hunks.length > 0 && patch.newPath);
  if (usable.length === 0) throw new FluxError("tool-validation", "Patch contains no applicable hunks.");
  for (const patch of usable) {
    if (patch.newPath.includes("..") || path.isAbsolute(patch.newPath)) {
      throw new FluxError("path-denied", `Patch targets a path outside the workspace: ${patch.newPath}`);
    }
  }
  return usable;
}

function normalizeDiffPath(raw: string): string {
  let value = raw.trim().split("\t")[0]!;
  if (value === "/dev/null") return "";
  value = value.replace(/^[ab]\//, "");
  return value.replace(/\\/g, "/");
}

/** Apply a unified diff inside a workspace. Returns per-file line statistics. */
export async function applyUnifiedDiff(workspaceRoot: string, diff: string): Promise<PatchResult> {
  const patches = parseUnifiedDiff(diff);
  const results: PatchResult["files"] = [];

  for (const patch of patches) {
    if (!patch.newPath) throw new FluxError("tool-validation", "Deleting files via patch is not supported. Ask the user.");
    const target = await resolveInsideWorkspace(workspaceRoot, patch.newPath);
    const original = await readFile(target.absolute, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    const created = original === null;
    const originalLines = created ? [] : original.replace(/\r\n/g, "\n").split("\n");
    const output: string[] = [];
    let cursor = 0;
    let added = 0;
    let removed = 0;

    for (const hunk of patch.hunks) {
      const start = Math.max(0, hunk.oldStart - 1);
      if (start < cursor) throw new FluxError("tool-validation", `Overlapping hunks in ${patch.newPath}.`);
      output.push(...originalLines.slice(cursor, start));
      cursor = start;

      for (const raw of hunk.lines) {
        const marker = raw[0];
        const text = raw.slice(1);
        if (marker === " ") {
          if (originalLines[cursor] !== text) {
            throw new FluxError(
              "tool-validation",
              `Patch context mismatch in ${patch.newPath} at line ${cursor + 1} (expected "${text.slice(0, 60)}").`,
            );
          }
          output.push(text);
          cursor += 1;
        } else if (marker === "-") {
          if (originalLines[cursor] !== text) {
            throw new FluxError(
              "tool-validation",
              `Patch deletion mismatch in ${patch.newPath} at line ${cursor + 1}.`,
            );
          }
          cursor += 1;
          removed += 1;
        } else {
          output.push(text);
          added += 1;
        }
      }
    }
    output.push(...originalLines.slice(cursor));
    // New text files conventionally end with a newline; patches that omit the
    // trailing marker still get one, matching how an editor would save the file.
    if (created && output.length > 0 && output[output.length - 1] !== "") output.push("");
    await writeFile(target.absolute, output.join("\n"), "utf8");
    results.push({ path: patch.newPath, created, added, removed });
  }
  return { files: results };
}
