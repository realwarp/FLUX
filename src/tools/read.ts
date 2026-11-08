// Read workspace files after containment and approval checks.
import { readFile } from "node:fs/promises";
import { ApprovalPolicy } from "../safety/approval.js";
import { validatePathArguments } from "../safety/validation.js";
import { Workspace } from "../safety/workspace.js";

export async function readTool(workspace: Workspace, policy: ApprovalPolicy, input: unknown): Promise<string> {
  const args = validatePathArguments(input);
  const file = await workspace.resolve(args.path, { mustExist: true });
  await policy.require({ operation: "read", description: `Read ${args.path}`, path: file });
  return readFile(file, "utf8");
}

export const readFileTool = readTool;
