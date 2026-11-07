import type { PermissionMode } from "@flux/shared";

export type ActionKind = "read" | "write" | "shell" | "git-read" | "git-write";

export interface ActionRequest {
  kind: ActionKind;
  tool: string;
  path?: string;
  command?: string;
  cwd?: string;
  reason?: string;
}

export type Decision = "allow" | "ask" | "deny";

export interface PolicyResult {
  decision: Decision;
  code:
    | "read-allowed"
    | "write-ask"
    | "write-allowed"
    | "read-only"
    | "shell-ask"
    | "shell-allowed"
    | "trusted-command"
    | "destructive-command"
    | "git-write-ask"
    | "git-read-allowed";
  reason: string;
}

export interface PolicyOptions {
  mode: PermissionMode;
  /** Commands the user explicitly trusted for this session. */
  trustedCommands?: string[];
  /** Extra always-denied command patterns. */
  deniedPatterns?: RegExp[];
}

const DESTRUCTIVE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bgit\s+reset\s+--hard\b/i, reason: "git reset --hard discards working-tree changes" },
  { pattern: /\bgit\s+clean\s+-[a-z]*f[a-z]*\b/i, reason: "git clean deletes untracked files" },
  { pattern: /\bgit\s+push\s+.*--force\b/i, reason: "force-push rewrites remote history" },
  { pattern: /\bgit\s+push\s+.*-f\b/i, reason: "force-push rewrites remote history" },
  { pattern: /\brm\s+-rf\s+(\/|\*|~|\$HOME|[A-Za-z]:\\)\s*$/i, reason: "broad recursive delete" },
  { pattern: /\bdel\s+\/[sfq]\s+.*\*\.\*\s*$/i, reason: "broad recursive delete" },
  { pattern: /\bformat\s+[a-z]:/i, reason: "disk format" },
  { pattern: /\bmkfs(\.|\s)/i, reason: "filesystem creation destroys data" },
  { pattern: /\bshutdown\b|\breboot\b/i, reason: "system power control" },
  { pattern: /Remove-Item\s+.*-Recurse\s+.*-Force/i, reason: "broad recursive delete" },
];

/**
 * Central permission policy. The safe default (`ask`) permits read-only work
 * and requires explicit approval for writes and shell commands.
 */
export class PermissionPolicy {
  private readonly trusted = new Set<string>();

  constructor(private readonly options: PolicyOptions) {
    for (const command of options.trustedCommands ?? []) this.trusted.add(command.trim());
  }

  get mode(): PermissionMode {
    return this.options.mode;
  }

  trustCommand(command: string): void {
    this.trusted.add(command.trim());
  }

  evaluate(action: ActionRequest): PolicyResult {
    const destructive = action.command ? DESTRUCTIVE_PATTERNS.find((entry) => entry.pattern.test(action.command!)) : undefined;
    if (destructive) {
      return {
        decision: "deny",
        code: "destructive-command",
        reason: `${destructive.reason}. Ask the user to run this manually if they intend it.`,
      };
    }
    for (const denied of this.options.deniedPatterns ?? []) {
      if (action.command && denied.test(action.command)) {
        return { decision: "deny", code: "destructive-command", reason: "Command matches a denied pattern." };
      }
    }

    if (action.kind === "read" || action.kind === "git-read") {
      return {
        decision: "allow",
        code: action.kind === "read" ? "read-allowed" : "git-read-allowed",
        reason: "Read-only operations are allowed inside the workspace.",
      };
    }

    if (this.options.mode === "read-only") {
      return {
        decision: "deny",
        code: "read-only",
        reason: "Session is in read-only mode. Restart without read-only mode to edit or run commands.",
      };
    }

    if (action.kind === "shell") {
      if (this.options.mode === "accept-edits") {
        return { decision: "allow", code: "shell-allowed", reason: "Session accepts edits and commands without prompting." };
      }
      const command = action.command?.trim() ?? "";
      if (command && this.trusted.has(command)) {
        return { decision: "allow", code: "trusted-command", reason: "Command was trusted for this session." };
      }
      return { decision: "ask", code: "shell-ask", reason: "Shell commands require approval." };
    }

    if (action.kind === "git-write") {
      return {
        decision: this.options.mode === "accept-edits" ? "allow" : "ask",
        code: this.options.mode === "accept-edits" ? "write-allowed" : "git-write-ask",
        reason: "Git write operations change repository state.",
      };
    }

    // write
    if (this.options.mode === "accept-edits") {
      return { decision: "allow", code: "write-allowed", reason: "Session accepts edits without prompting." };
    }
    return { decision: "ask", code: "write-ask", reason: "File writes require approval." };
  }
}

export function isDestructiveCommand(command: string): boolean {
  return DESTRUCTIVE_PATTERNS.some((entry) => entry.pattern.test(command));
}
