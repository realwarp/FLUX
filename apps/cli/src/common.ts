import { FluxApp } from "@flux/app-core";
import { DenyAllApprovalHandler, StaticApprovalHandler, type ApprovalHandler } from "@flux/permissions";

export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | true>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const equals = arg.indexOf("=");
      if (equals !== -1) {
        flags[arg.slice(2, equals)] = arg.slice(equals + 1);
      } else {
        const next = argv[index + 1];
        if (next && !next.startsWith("-")) {
          flags[arg.slice(2)] = next;
          index += 1;
        } else {
          flags[arg.slice(2)] = true;
        }
      }
    } else if (arg.startsWith("-") && arg.length > 1) {
      flags[arg.slice(1)] = true;
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}

export function stringFlag(flags: ParsedArgs["flags"], name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

export function boolFlag(flags: ParsedArgs["flags"], name: string): boolean {
  return flags[name] === true || flags[name] === "true";
}

export interface OpenOptions {
  cwd?: string;
  yes?: boolean;
  maxSteps?: number;
  permissionMode?: "read-only" | "ask" | "accept-edits";
}

export async function openApp(options: OpenOptions = {}): Promise<FluxApp> {
  return FluxApp.create({
    cwd: options.cwd ?? process.cwd(),
    approvals: approvalsFor(options.yes ?? false),
    permissionMode: options.permissionMode,
    maxSteps: options.maxSteps,
  });
}

export function approvalsFor(yes: boolean): ApprovalHandler {
  return yes ? new StaticApprovalHandler("approved") : new DenyAllApprovalHandler();
}

export function approvedAlways(): ApprovalHandler {
  return new StaticApprovalHandler("always");
}

const supportsColor = process.stdout.isTTY && process.env["NO_COLOR"] === undefined;

export const paint = {
  bold: (text: string): string => (supportsColor ? `\x1b[1m${text}\x1b[0m` : text),
  dim: (text: string): string => (supportsColor ? `\x1b[2m${text}\x1b[0m` : text),
  green: (text: string): string => (supportsColor ? `\x1b[32m${text}\x1b[0m` : text),
  red: (text: string): string => (supportsColor ? `\x1b[31m${text}\x1b[0m` : text),
  yellow: (text: string): string => (supportsColor ? `\x1b[33m${text}\x1b[0m` : text),
  cyan: (text: string): string => (supportsColor ? `\x1b[36m${text}\x1b[0m` : text),
};

export function table(rows: string[][]): string {
  if (rows.length === 0) return "";
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, cell.length);
    });
  }
  return rows.map((row) => row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ").trimEnd()).join("\n");
}
