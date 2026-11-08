// Execute approved shell commands with workspace confinement, timeout, and output bounds.
import { spawn } from "node:child_process";
import { ApprovalPolicy } from "../safety/approval.js";
import { validateShellArguments } from "../safety/validation.js";
import { Workspace } from "../safety/workspace.js";

export interface ShellResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly truncated: boolean;
}

export async function shellTool(workspace: Workspace, policy: ApprovalPolicy, input: unknown): Promise<ShellResult> {
  const args = validateShellArguments(input);
  assertShellCommandIsWorkspaceRelative(args.command);
  await policy.require({ operation: "shell", description: `Run ${args.command}`, command: args.command });
  return new Promise((resolve, reject) => {
    const child = spawn(args.command, {
      cwd: workspace.root,
      shell: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let truncated = false;
    const append = (target: "stdout" | "stderr", chunk: Buffer): void => {
      if (bytes >= args.maxOutputBytes!) {
        truncated = true;
        return;
      }

      const remaining = args.maxOutputBytes! - bytes;
      const text = chunk.subarray(0, remaining).toString("utf8");
      bytes += Buffer.byteLength(text);
      if (target === "stdout") stdout += text;
      else stderr += text;
      if (text.length < chunk.length) truncated = true;
    };
    child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
    const timer = setTimeout(() => {
      child.kill();
    }, args.timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ exitCode, signal, stdout, stderr, timedOut: exitCode === null && signal !== null, truncated });
    });
  });
}

export const executeShellTool = shellTool;

function assertShellCommandIsWorkspaceRelative(command: string): void {
  if (command.includes("\0")) throw new Error("Shell command contains a NUL byte");
  if (/(^|[\s"'=])\.\.(?:[\\/]|$)/.test(command)) {
    throw new Error("Shell command contains a path outside the workspace");
  }
  if (/(^|[\s"'=])(?:[A-Za-z]:[\\/]|[\\/]{1,2})/.test(command)) {
    throw new Error("Shell command contains an absolute path");
  }
}
