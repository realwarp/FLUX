// Apply a constrained unified diff to one workspace file.
import { readFile, writeFile } from "node:fs/promises";
import { ApprovalPolicy } from "../safety/approval.js";
import { ToolArgumentError, validateWriteArguments } from "../safety/validation.js";
import { Workspace } from "../safety/workspace.js";

export async function patchTool(workspace: Workspace, policy: ApprovalPolicy, input: unknown): Promise<void> {
  const args = validateWriteArguments(input);
  const file = await workspace.resolve(args.path, { mustExist: true });
  await policy.require({ operation: "patch", description: `Patch ${args.path}`, path: file });
  const source = await readFile(file, "utf8");
  await writeFile(file, applyUnifiedPatch(source, args.content), "utf8");
}

export const applyPatchTool = patchTool;

function applyUnifiedPatch(source: string, patch: string): string {
  const lines = source.split(/\r?\n/);
  const patchLines = patch.split(/\r?\n/);
  const result: string[] = [];
  let sourceIndex = 0;
  let index = 0;
  while (index < patchLines.length) {
    if (!patchLines[index].startsWith("@@")) {
      index++;
      continue;
    }
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(patchLines[index]);
    if (!header) throw new ToolArgumentError("Invalid unified patch hunk");
    const start = Number(header[1]) - 1;
    if (start < sourceIndex || start > lines.length) throw new ToolArgumentError("Patch context is outside file");
    result.push(...lines.slice(sourceIndex, start));
    sourceIndex = start;
    index++;
    while (index < patchLines.length && !patchLines[index].startsWith("@@")) {
      const line = patchLines[index++];
      if (line === "\\ No newline at end of file") continue;
      const marker = line[0];
      const value = line.slice(1);
      if (marker === " ") {
        if (lines[sourceIndex] !== value) throw new ToolArgumentError("Patch context does not match");
        result.push(value);
        sourceIndex++;
      } else if (marker === "-") {
        if (lines[sourceIndex] !== value) throw new ToolArgumentError("Patch removal does not match");
        sourceIndex++;
      } else if (marker === "+") {
        result.push(value);
      } else {
        throw new ToolArgumentError("Invalid unified patch line");
      }
    }
  }
  result.push(...lines.slice(sourceIndex));
  return result.join("\n");
}
