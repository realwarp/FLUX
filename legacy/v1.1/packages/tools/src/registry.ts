import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { FluxError, truncate, zodMessage, type ToolDefinition } from "@flux/shared";
import { RepositoryContext, resolveInsideWorkspace } from "@flux/repository";
import { PermissionPolicy, type ActionKind, type ApprovalHandler } from "@flux/permissions";
import { applyUnifiedDiff } from "./patch.ts";
import { runGit, runProcess } from "./process.ts";

export interface ToolContext {
  repo: RepositoryContext;
  policy: PermissionPolicy;
  approvals: ApprovalHandler;
  signal?: AbortSignal;
  onNotice?: (message: string) => void;
}

export interface ToolResult {
  ok: boolean;
  content: string;
  meta?: Record<string, unknown>;
}

interface ToolSpec {
  definition: ToolDefinition;
  action: ActionKind;
  schema: z.ZodTypeAny;
  run(input: unknown, ctx: ToolContext): Promise<ToolResult>;
}

const MAX_TOOL_OUTPUT = 40_000;

function ok(content: string, meta?: Record<string, unknown>): ToolResult {
  return { ok: true, content: truncate(content, MAX_TOOL_OUTPUT), meta };
}

function fail(content: string, meta?: Record<string, unknown>): ToolResult {
  return { ok: false, content: truncate(content, MAX_TOOL_OUTPUT), meta };
}

const listFilesSchema = z.object({
  path: z.string().optional(),
  maxEntries: z.number().int().positive().max(2000).optional(),
});

const searchSchema = z.object({
  query: z.string().min(1),
  glob: z.string().optional(),
  maxHits: z.number().int().positive().max(200).optional(),
});

const readSchema = z.object({
  path: z.string().min(1),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
});

const writeSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

const patchSchema = z.object({
  patch: z.string().min(1),
});

const commandSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().max(600_000).optional(),
});

const gitDiffSchema = z.object({
  staged: z.boolean().optional(),
  path: z.string().optional(),
});

const gitLogSchema = z.object({
  limit: z.number().int().positive().max(100).optional(),
});

const planSchema = z.object({
  plan: z.string().min(1),
  steps: z.array(z.string()).default([]),
});

export class ToolExecutor {
  private readonly specs = new Map<string, ToolSpec>();

  constructor() {
    this.register({
      definition: {
        name: "list_files",
        description: "List workspace files (ignore-aware, bounded). Prefer this before reading files.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Subdirectory relative to the workspace root." },
            maxEntries: { type: "number", description: "Maximum entries (default 300)." },
          },
        },
      },
      action: "read",
      schema: listFilesSchema,
      run: async (input, ctx) => {
        const { path: subPath, maxEntries } = input as z.infer<typeof listFilesSchema>;
        const files = await ctx.repo.listFiles({ subPath, maxEntries: maxEntries ?? 300, maxDepth: 8 });
        return ok(
          `${files.length} file(s) under ${subPath || "."}:\n${files.map((file) => file.path).join("\n")}`,
          { count: files.length },
        );
      },
    });

    this.register({
      definition: {
        name: "search_text",
        description: "Search text across the workspace (literal by default) and return file:line matches.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Text to find." },
            glob: { type: "string", description: "Optional glob filter, for example **/*.ts" },
            maxHits: { type: "number", description: "Maximum matches (default 50)." },
          },
          required: ["query"],
        },
      },
      action: "read",
      schema: searchSchema,
      run: async (input, ctx) => {
        const { query, glob, maxHits } = input as z.infer<typeof searchSchema>;
        const hits = await ctx.repo.searchText(query, { glob, maxHits });
        if (hits.length === 0) return ok(`No matches for ${JSON.stringify(query)}.`);
        return ok(
          hits.map((hit) => `${hit.path}:${hit.line}: ${hit.text}`).join("\n"),
          { count: hits.length },
        );
      },
    });

    this.register({
      definition: {
        name: "read_file",
        description: "Read a UTF-8 file inside the workspace, optionally a line range.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path relative to the workspace root." },
            startLine: { type: "number", description: "1-based first line." },
            endLine: { type: "number", description: "1-based last line." },
          },
          required: ["path"],
        },
      },
      action: "read",
      schema: readSchema,
      run: async (input, ctx) => {
        const { path: filePath, startLine, endLine } = input as z.infer<typeof readSchema>;
        const result = await ctx.repo.readFile(filePath, { startLine, endLine });
        const header = `${result.path}${result.truncated ? " (truncated)" : ""} — ${result.totalLines} lines`;
        const body = startLine || endLine
          ? result.content
              .split("\n")
              .map((line, index) => `${(startLine ?? 1) + index}: ${line}`)
              .join("\n")
          : result.content;
        return ok(`${header}\n${body}`, { path: result.path, bytes: result.bytes });
      },
    });

    this.register({
      definition: {
        name: "write_file",
        description: "Create or replace a file inside the workspace. Requires approval in safe mode.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            content: { type: "string" },
          },
          required: ["path", "content"],
        },
      },
      action: "write",
      schema: writeSchema,
      run: async (input, ctx) => {
        const { path: filePath, content } = input as z.infer<typeof writeSchema>;
        const target = await resolveInsideWorkspace(ctx.repo.root, filePath, { allowSecret: false });
        const previous = await readFile(target.absolute, "utf8").catch(() => "");
        await mkdir(path.dirname(target.absolute), { recursive: true });
        await import("node:fs/promises").then((fs) => fs.writeFile(target.absolute, content, "utf8"));
        const added = content.split("\n").length;
        const removed = previous ? previous.split("\n").length : 0;
        return ok(`Wrote ${target.relative} (${added} lines; replaced ${removed} lines).`, {
          path: target.relative,
          created: previous === "",
        });
      },
    });

    this.register({
      definition: {
        name: "apply_patch",
        description:
          "Apply a unified diff inside the workspace. Use standard ---/+++/@@ hunks. Requires approval in safe mode.",
        parameters: {
          type: "object",
          properties: {
            patch: { type: "string", description: "Unified diff text." },
          },
          required: ["patch"],
        },
      },
      action: "write",
      schema: patchSchema,
      run: async (input, ctx) => {
        const { patch } = input as z.infer<typeof patchSchema>;
        const result = await applyUnifiedDiff(ctx.repo.root, patch);
        const summary = result.files
          .map((file) => `${file.created ? "created" : "modified"} ${file.path} (+${file.added}/-${file.removed})`)
          .join("\n");
        return ok(`Patch applied:\n${summary}`, { files: result.files });
      },
    });

    this.register({
      definition: {
        name: "run_command",
        description:
          "Run a shell command in the workspace. Output and duration are capped; a timeout is enforced. Requires approval in safe mode.",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string", description: "Command line to execute." },
            cwd: { type: "string", description: "Working directory relative to the workspace root." },
            timeoutMs: { type: "number", description: "Timeout in milliseconds (default 120000, max 600000)." },
          },
          required: ["command"],
        },
      },
      action: "shell",
      schema: commandSchema,
      run: async (input, ctx) => {
        const { command, cwd, timeoutMs } = input as z.infer<typeof commandSchema>;
        const workdir = cwd ? (await resolveInsideWorkspace(ctx.repo.root, cwd)).absolute : ctx.repo.root;
        const info = await stat(workdir).catch(() => undefined);
        if (!info?.isDirectory()) throw new FluxError("tool-validation", `Working directory not found: ${cwd}`);
        const result = await runProcess(command, {
          cwd: workdir,
          timeoutMs: timeoutMs ?? 120_000,
          signal: ctx.signal,
        });
        const header = `exit=${result.exitCode} duration=${result.durationMs}ms${result.timedOut ? " TIMEOUT" : ""}${result.truncated ? " output-truncated" : ""}`;
        const body = [
          header,
          result.stdout ? `--- stdout ---\n${result.stdout}` : "",
          result.stderr ? `--- stderr ---\n${result.stderr}` : "",
        ]
          .filter(Boolean)
          .join("\n");
        return {
          ok: result.exitCode === 0 && !result.timedOut,
          content: truncate(body || header, MAX_TOOL_OUTPUT),
          meta: {
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            timedOut: result.timedOut,
            truncated: result.truncated,
            command,
            cwd: workdir,
          },
        };
      },
    });

    this.register({
      definition: {
        name: "git_status",
        description: "Show the short Git status of the workspace (read-only).",
        parameters: { type: "object", properties: {} },
      },
      action: "git-read",
      schema: z.object({}),
      run: async (_input, ctx) => {
        const result = await runGit(["status", "--short", "--branch"], ctx.repo.root);
        return ok(result.stdout.trim() || "clean working tree", { exitCode: result.exitCode });
      },
    });

    this.register({
      definition: {
        name: "git_diff",
        description: "Show the unstaged or staged Git diff (read-only), optionally for one path.",
        parameters: {
          type: "object",
          properties: {
            staged: { type: "boolean" },
            path: { type: "string" },
          },
        },
      },
      action: "git-read",
      schema: gitDiffSchema,
      run: async (input, ctx) => {
        const { staged, path: filePath } = input as z.infer<typeof gitDiffSchema>;
        const args = ["diff", "--no-color"];
        if (staged) args.push("--cached");
        if (filePath) {
          await resolveInsideWorkspace(ctx.repo.root, filePath);
          args.push("--", filePath);
        }
        const result = await runGit(args, ctx.repo.root);
        return ok(result.stdout.trim() || "no changes", { exitCode: result.exitCode });
      },
    });

    this.register({
      definition: {
        name: "git_log",
        description: "Show recent Git commits (read-only).",
        parameters: {
          type: "object",
          properties: { limit: { type: "number" } },
        },
      },
      action: "git-read",
      schema: gitLogSchema,
      run: async (input, ctx) => {
        const { limit } = input as z.infer<typeof gitLogSchema>;
        const result = await runGit(["log", "--oneline", "-n", String(limit ?? 10), "--no-decorate"], ctx.repo.root);
        return ok(result.stdout.trim() || "no commits", { exitCode: result.exitCode });
      },
    });

    this.register({
      definition: {
        name: "propose_plan",
        description:
          "Propose an implementation plan and wait for user approval before changing files. Use for any multi-step or risky change.",
        parameters: {
          type: "object",
          properties: {
            plan: { type: "string", description: "Short plan summary." },
            steps: { type: "array", items: { type: "string" }, description: "Ordered steps." },
          },
          required: ["plan"],
        },
      },
      action: "read",
      schema: planSchema,
      run: async (input) => {
        const { plan, steps } = input as z.infer<typeof planSchema>;
        return ok(`Plan recorded:\n${plan}${steps.length ? `\n${steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}` : ""}`, {
          plan,
          steps,
        });
      },
    });
  }

  private register(spec: ToolSpec): void {
    this.specs.set(spec.definition.name, spec);
  }

  names(): string[] {
    return [...this.specs.keys()];
  }

  definitions(allow: (name: string) => boolean = () => true): ToolDefinition[] {
    return [...this.specs.values()]
      .filter((spec) => allow(spec.definition.name))
      .map((spec) => spec.definition);
  }

  has(name: string): boolean {
    return this.specs.has(name);
  }

  /** Validate, authorize, and execute a tool call. Never throws for expected failures. */
  async execute(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolResult> {
    const spec = this.specs.get(name);
    if (!spec) return fail(`Unknown tool: ${name}`);

    let input: unknown;
    try {
      input = spec.schema.parse(rawInput ?? {});
    } catch (error) {
      return fail(`Invalid arguments for ${name}: ${zodMessage(error)}`);
    }

    const subject = this.describeSubject(name, input);
    const action = this.actionFor(name, input);
    const decision = ctx.policy.evaluate({ kind: action, tool: name, path: subject, command: action === "shell" ? String((input as { command?: string }).command ?? "") : undefined });

    if (decision.decision === "deny") {
      return fail(`Permission denied: ${decision.reason}`);
    }
    if (decision.decision === "ask") {
      const approval = await ctx.approvals.request({
        id: `${name}-${Date.now()}`,
        title: name === "run_command" ? "Run command" : "Apply change",
        detail: decision.reason,
        kind: name === "run_command" ? "shell" : "write",
        subject,
        diff: name === "apply_patch" ? String((input as { patch?: string }).patch ?? "").slice(0, 8000) : undefined,
      });
      if (approval === "rejected") {
        return fail("User rejected this action.");
      }
      if (approval === "always" && name === "run_command") {
        ctx.policy.trustCommand(String((input as { command?: string }).command ?? ""));
      }
    }

    try {
      return await spec.run(input, ctx);
    } catch (error) {
      if (error instanceof FluxError) return fail(`${error.category}: ${error.message}`);
      return fail(error instanceof Error ? error.message : String(error));
    }
  }

  private actionFor(name: string, input: unknown): ActionKind {
    if (name === "run_command") return "shell";
    if (name === "write_file" || name === "apply_patch") return "write";
    if (name.startsWith("git_")) return "git-read";
    const spec = this.specs.get(name);
    return spec?.action ?? "read";
  }

  private describeSubject(name: string, input: unknown): string {
    if (name === "run_command") return String((input as { command?: string }).command ?? "");
    if ("path" in (input as Record<string, unknown>)) return String((input as { path?: string }).path);
    if (name === "apply_patch") return "unified diff";
    return name;
  }
}

/** Tools available to read-only specialist roles. */
export const READ_ONLY_TOOLS = new Set([
  "list_files",
  "search_text",
  "read_file",
  "git_status",
  "git_diff",
  "git_log",
  "propose_plan",
]);
