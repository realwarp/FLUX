import { spawn } from "node:child_process";
import { FluxError } from "@flux/shared";

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
  timedOut: boolean;
}

export interface ProcessOptions {
  cwd: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: Record<string, string | undefined>;
  signal?: AbortSignal;
}

/** Run a command with a timeout and bounded output capture. */
export function runProcess(command: string, options: ProcessOptions): Promise<ProcessResult> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const maxOutputBytes = options.maxOutputBytes ?? 60_000;
  const started = Date.now();
  const isWindows = process.platform === "win32";
  const shellCommand = isWindows ? "powershell.exe" : "/bin/sh";
  const shellArgs = isWindows
    ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command]
    : ["-lc", command];

  return new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(shellCommand, shellArgs, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env, NO_COLOR: "1", CI: "1" },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let settled = false;
    let timedOut = false;

    const append = (target: "stdout" | "stderr", chunk: Buffer): void => {
      const current = target === "stdout" ? stdout : stderr;
      const remaining = maxOutputBytes - Buffer.byteLength(current);
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      const slice = chunk.subarray(0, remaining);
      if (slice.length < chunk.length) truncated = true;
      if (target === "stdout") stdout += slice.toString("utf8");
      else stderr += slice.toString("utf8");
    };

    child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    const onAbort = (): void => {
      timedOut = true;
      child.kill();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve({
        exitCode: code,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        truncated,
        timedOut,
      });
    };

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      reject(new FluxError("internal", `Failed to start command: ${error.message}`, { cause: error }));
    });

    child.on("close", (code) => finish(code ?? -1));
  });
}

export async function runGit(args: string[], cwd: string, timeoutMs = 20_000): Promise<ProcessResult> {
  const command = ["git", ...args].map(quoteArgument).join(" ");
  return runProcess(command, { cwd, timeoutMs, maxOutputBytes: 200_000 });
}

function quoteArgument(value: string): string {
  if (/^[A-Za-z0-9@%_+=:,./-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}
