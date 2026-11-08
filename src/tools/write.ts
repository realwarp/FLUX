// Write workspace files only after an explicit approval decision.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ApprovalPolicy } from "../safety/approval.js";
import { validateWriteArguments } from "../safety/validation.js";
import { Workspace } from "../safety/workspace.js";

export async function writeTool(workspace: Workspace, policy: ApprovalPolicy, input: unknown): Promise<void> {
  const args = validateWriteArguments(input);
  const file = await workspace.resolve(args.path);
  await policy.require({ operation: "write", description: `Write ${args.path}`, path: file });
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, args.content, "utf8");
}

export const writeFileTool = writeTool;
