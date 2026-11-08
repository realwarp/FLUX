// Apply a constrained unified diff to one workspace file.
import { randomUUID } from "node:crypto";
import { open, readFile, realpath, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { ApprovalPolicy } from "../safety/approval.js";
import { ToolArgumentError, validateWriteArguments } from "../safety/validation.js";
import { Workspace } from "../safety/workspace.js";

export async function patchTool(workspace: Workspace, policy: ApprovalPolicy, input: unknown): Promise<void> {
  const args = validateWriteArguments(input);
  const candidate = await workspace.resolve(args.path, { mustExist: true });
  const file = await realpath(candidate);
  await policy.require({
    operation: "patch",
    description: `Patch ${args.path} (${args.content.length} bytes)`,
    path: file,
    preview: args.content,
  });

  const source = await readFile(file, "utf8");
  const result = applyUnifiedPatch(source, args.content);
  const fileInfo = await stat(file);
  await replaceAtomically(file, source, result, fileInfo.mode & 0o777);
}

export const applyPatchTool = patchTool;

function applyUnifiedPatch(source: string, patch: string): string {
  const newlineMatches = source.match(/\r\n|\n|\r/g) ?? [];
  const newline = newlineMatches[0] ?? "\n";
  if (newlineMatches.some((candidate) => candidate !== newline)) {
    throw new ToolArgumentError("Patch target contains mixed line endings; file was not modified");
  }

  const hasFinalNewline = /(?:\r\n|\n|\r)$/.test(source);
  const sourceLines = source.length === 0 ? [] : source.split(/\r\n|\n|\r/);
  if (hasFinalNewline) sourceLines.pop();

  const patchLines = patch.split(/\r\n|\n|\r/);
  if (/(?:\r\n|\n|\r)$/.test(patch)) patchLines.pop();

  const output: string[] = [];
  let sourceIndex = 0;
  let patchIndex = 0;
  let hunkFound = false;
  let changed = false;
  let noNewlineOutputIndex: number | undefined;
  let lastOutputLineWasAdded = false;

  while (patchIndex < patchLines.length) {
    const line = patchLines[patchIndex]!;
    if (!line.startsWith("@@")) {
      if (hunkFound && line.startsWith("--- ")) {
        throw new ToolArgumentError("Patch must target one file; file was not modified");
      }
      patchIndex++;
      continue;
    }

    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(line);
    if (!header) throw new ToolArgumentError("Invalid unified patch hunk");

    const oldStart = Number(header[1]);
    const oldCount = Number(header[2] ?? "1");
    const newStart = Number(header[3]);
    const newCount = Number(header[4] ?? "1");
    if ((oldStart === 0 && oldCount !== 0) || (newStart === 0 && newCount !== 0)) {
      throw new ToolArgumentError("Invalid unified patch line range");
    }

    const sourceHunkStart = oldCount === 0 ? oldStart : oldStart - 1;
    const outputHunkStart = newCount === 0 ? newStart : newStart - 1;
    if (
      sourceHunkStart < sourceIndex ||
      sourceHunkStart > sourceLines.length ||
      outputHunkStart !== output.length + sourceHunkStart - sourceIndex
    ) {
      throw new ToolArgumentError("Patch hunk is out of sequence");
    }

    output.push(...sourceLines.slice(sourceIndex, sourceHunkStart));
    if (sourceHunkStart > sourceIndex) lastOutputLineWasAdded = false;
    sourceIndex = sourceHunkStart;
    patchIndex++;
    hunkFound = true;

    let oldLinesSeen = 0;
    let newLinesSeen = 0;
    let lastOutputWasLine = false;

    while (patchIndex < patchLines.length && !patchLines[patchIndex]!.startsWith("@@")) {
      const patchLine = patchLines[patchIndex++]!;
      if (patchLine === "\\ No newline at end of file") {
        if (lastOutputWasLine && output.length === outputHunkStart + newLinesSeen) {
          noNewlineOutputIndex = output.length - 1;
        }
        lastOutputWasLine = false;
        continue;
      }

      const marker = patchLine[0];
      const value = patchLine.slice(1);
      if (marker === " ") {
        if (sourceLines[sourceIndex] !== value) {
          throw new ToolArgumentError("Patch context does not match; file was not modified");
        }
        output.push(value);
        lastOutputLineWasAdded = false;
        sourceIndex++;
        oldLinesSeen++;
        newLinesSeen++;
        lastOutputWasLine = true;
      } else if (marker === "-") {
        if (sourceLines[sourceIndex] !== value) {
          throw new ToolArgumentError("Patch removal does not match; file was not modified");
        }
        sourceIndex++;
        oldLinesSeen++;
        changed = true;
        lastOutputWasLine = false;
      } else if (marker === "+") {
        output.push(value);
        lastOutputLineWasAdded = true;
        newLinesSeen++;
        changed = true;
        lastOutputWasLine = true;
      } else {
        throw new ToolArgumentError("Invalid unified patch line");
      }
    }

    if (oldLinesSeen !== oldCount || newLinesSeen !== newCount) {
      throw new ToolArgumentError("Patch hunk line counts do not match; file was not modified");
    }
  }

  if (!hunkFound || !changed) throw new ToolArgumentError("Patch must contain a change");
  const suffix = sourceLines.slice(sourceIndex);
  output.push(...suffix);
  if (suffix.length > 0) lastOutputLineWasAdded = false;
  const markerIsAtEndOfFile = noNewlineOutputIndex === output.length - 1;
  const outputHasFinalNewline = output.length > 0 && !markerIsAtEndOfFile && (lastOutputLineWasAdded || hasFinalNewline);
  const patched = output.join(newline) + (outputHasFinalNewline ? newline : "");
  if (patched === source) throw new ToolArgumentError("Patch produces no changes; file was not modified");
  return patched;
}

async function replaceAtomically(file: string, original: string, content: string, mode: number): Promise<void> {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.flux-tmp`);
  try {
    const handle = await open(temporary, "wx", mode);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    if (await readFile(file, "utf8") !== original) {
      throw new ToolArgumentError("Patch target changed while the patch was prepared; file was not modified");
    }
    await rename(temporary, file);
  } finally {
    try {
      await unlink(temporary);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }
  }
}
