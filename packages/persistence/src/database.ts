import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  newId,
  nowIso,
  type ChatRole,
  type MessageRecord,
  type ModelRef,
  type TaskState,
  type ToolCall,
  type UsageEvent,
  type VerificationRecord,
} from "@flux/shared";

export interface SessionRow {
  id: string;
  title: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  defaultModel?: ModelRef;
  status: "active" | "completed" | "failed";
}

export interface ToolCallRow {
  id: string;
  sessionId: string;
  taskId?: string;
  agentId?: string;
  name: string;
  arguments: string;
  result?: string;
  ok?: boolean;
  createdAt: string;
  executed: boolean;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  cwd TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  default_provider TEXT,
  default_model TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  agent_id TEXT,
  tool_calls TEXT,
  tool_call_id TEXT,
  interrupted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  title TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  error TEXT
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  task_id TEXT,
  agent_id TEXT,
  name TEXT NOT NULL,
  arguments TEXT NOT NULL,
  result TEXT,
  ok INTEGER,
  created_at TEXT NOT NULL,
  executed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  task_id TEXT,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  decision TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS verifications (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  task_id TEXT,
  command TEXT NOT NULL,
  cwd TEXT NOT NULL,
  exit_code INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  output TEXT NOT NULL,
  truncated INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  task_id TEXT,
  agent_id TEXT,
  provider_profile_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  requests INTEGER NOT NULL,
  source TEXT NOT NULL,
  estimated_from TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_session ON usage_events(session_id);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  task_id TEXT,
  role TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  summary TEXT
);
`;

export class FluxDatabase {
  readonly db: Database;

  constructor(filePath: string) {
    if (filePath !== ":memory:") {
      mkdirSync(path.dirname(filePath), { recursive: true });
    }
    this.db = new Database(filePath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  migrate(): void {
    this.db.exec(SCHEMA);
    const messageColumns = this.db.query<{ name: string }, []>("PRAGMA table_info(messages)").all();
    if (!messageColumns.some((column) => column.name === "tool_call_id")) {
      this.db.exec("ALTER TABLE messages ADD COLUMN tool_call_id TEXT");
    }
    const row = this.db.query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'schema_version'").get();
    if (!row) {
      this.db
        .query("INSERT INTO meta (key, value) VALUES ('schema_version', '1')")
        .run();
    }
  }

  schemaVersion(): number {
    const row = this.db.query<{ value: string }, []>("SELECT value FROM meta WHERE key = 'schema_version'").get();
    return row ? Number(row.value) : 0;
  }

  createSession(input: { cwd: string; title?: string; defaultModel?: ModelRef }): SessionRow {
    const at = nowIso();
    const session: SessionRow = {
      id: newId("ses"),
      title: input.title ?? "New session",
      cwd: input.cwd,
      createdAt: at,
      updatedAt: at,
      defaultModel: input.defaultModel,
      status: "active",
    };
    this.db
      .query(
        `INSERT INTO sessions (id, title, cwd, created_at, updated_at, default_provider, default_model, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.id,
        session.title,
        session.cwd,
        session.createdAt,
        session.updatedAt,
        session.defaultModel?.providerProfileId ?? null,
        session.defaultModel?.modelId ?? null,
        session.status,
      );
    return session;
  }

  updateSession(
    id: string,
    patch: { title?: string; status?: SessionRow["status"]; defaultModel?: ModelRef },
  ): void {
    const current = this.getSession(id);
    if (!current) return;
    const defaultModel = patch.defaultModel ?? current.defaultModel;
    this.db
      .query(
        `UPDATE sessions SET title = ?, status = ?, default_provider = ?, default_model = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        patch.title ?? current.title,
        patch.status ?? current.status,
        defaultModel?.providerProfileId ?? null,
        defaultModel?.modelId ?? null,
        nowIso(),
        id,
      );
  }

  getSession(id: string): SessionRow | undefined {
    const row = this.db
      .query<
        {
          id: string;
          title: string;
          cwd: string;
          created_at: string;
          updated_at: string;
          default_provider: string | null;
          default_model: string | null;
          status: SessionRow["status"];
        },
        [string]
      >("SELECT * FROM sessions WHERE id = ?")
      .get(id);
    if (!row) return undefined;
    return {
      id: row.id,
      title: row.title,
      cwd: row.cwd,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      defaultModel:
        row.default_provider && row.default_model
          ? { providerProfileId: row.default_provider, modelId: row.default_model }
          : undefined,
      status: row.status,
    };
  }

  listSessions(limit = 50): SessionRow[] {
    return this.db
      .query<{ id: string }, [number]>("SELECT id FROM sessions ORDER BY updated_at DESC LIMIT ?")
      .all(limit)
      .map((row) => this.getSession(row.id))
      .filter((session): session is SessionRow => Boolean(session));
  }

  deleteSession(id: string): void {
    for (const table of ["messages", "tasks", "tool_calls", "approvals", "verifications", "usage_events", "agent_runs"]) {
      this.db.query(`DELETE FROM ${table} WHERE session_id = ?`).run(id);
    }
    this.db.query("DELETE FROM sessions WHERE id = ?").run(id);
  }

  appendMessage(input: {
    sessionId: string;
    role: ChatRole;
    content: string;
    agentId?: string;
    toolCalls?: ToolCall[];
    toolCallId?: string;
    interrupted?: boolean;
  }): MessageRecord {
    const record: MessageRecord = {
      id: newId("msg"),
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      createdAt: nowIso(),
      agentId: input.agentId,
      toolCalls: input.toolCalls,
      toolCallId: input.toolCallId,
      interrupted: input.interrupted,
    };
    this.db
      .query(
        `INSERT INTO messages (id, session_id, role, content, created_at, agent_id, tool_calls, tool_call_id, interrupted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.sessionId,
        record.role,
        record.content,
        record.createdAt,
        record.agentId ?? null,
        record.toolCalls ? JSON.stringify(record.toolCalls) : null,
        record.toolCallId ?? null,
        record.interrupted ? 1 : 0,
      );
    this.db.query("UPDATE sessions SET updated_at = ? WHERE id = ?").run(nowIso(), record.sessionId);
    return record;
  }

  listMessages(sessionId: string): MessageRecord[] {
    const rows = this.db
      .query<
        {
          id: string;
          session_id: string;
          role: ChatRole;
          content: string;
          created_at: string;
          agent_id: string | null;
          tool_calls: string | null;
          tool_call_id: string | null;
          interrupted: number;
        },
        [string]
      >("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC")
      .all(sessionId);
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
      agentId: row.agent_id ?? undefined,
      toolCalls: row.tool_calls ? (JSON.parse(row.tool_calls) as ToolCall[]) : undefined,
      toolCallId: row.tool_call_id ?? undefined,
      interrupted: row.interrupted === 1,
    }));
  }

  createTask(input: { sessionId: string; title: string }): { id: string; state: TaskState } {
    const id = newId("tsk");
    const at = nowIso();
    this.db
      .query(
        `INSERT INTO tasks (id, session_id, title, state, created_at, updated_at) VALUES (?, ?, ?, 'queued', ?, ?)`,
      )
      .run(id, input.sessionId, input.title, at, at);
    return { id, state: "queued" };
  }

  setTaskState(id: string, state: TaskState, error?: string): void {
    this.db
      .query("UPDATE tasks SET state = ?, error = ?, updated_at = ? WHERE id = ?")
      .run(state, error ?? null, nowIso(), id);
  }

  getTask(id: string): { id: string; sessionId: string; title: string; state: TaskState; error?: string } | undefined {
    const row = this.db
      .query<
        { id: string; session_id: string; title: string; state: TaskState; error: string | null },
        [string]
      >("SELECT * FROM tasks WHERE id = ?")
      .get(id);
    if (!row) return undefined;
    return { id: row.id, sessionId: row.session_id, title: row.title, state: row.state, error: row.error ?? undefined };
  }

  /** Persist a tool call *before* dispatch so a crash cannot replay it blindly. */
  beginToolCall(input: {
    id: string;
    sessionId: string;
    taskId?: string;
    agentId?: string;
    name: string;
    args: string;
  }): void {
    const existing = this.db.query<{ id: string }, [string]>("SELECT id FROM tool_calls WHERE id = ?").get(input.id);
    if (existing) return;
    this.db
      .query(
        `INSERT INTO tool_calls (id, session_id, task_id, agent_id, name, arguments, created_at, executed)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(input.id, input.sessionId, input.taskId ?? null, input.agentId ?? null, input.name, input.args, nowIso());
  }

  finishToolCall(id: string, ok: boolean, result: string): void {
    this.db
      .query("UPDATE tool_calls SET result = ?, ok = ?, executed = 1 WHERE id = ?")
      .run(result, ok ? 1 : 0, id);
  }

  getToolCall(id: string): ToolCallRow | undefined {
    const row = this.db
      .query<
        {
          id: string;
          session_id: string;
          task_id: string | null;
          agent_id: string | null;
          name: string;
          arguments: string;
          result: string | null;
          ok: number | null;
          created_at: string;
          executed: number;
        },
        [string]
      >("SELECT * FROM tool_calls WHERE id = ?")
      .get(id);
    if (!row) return undefined;
    return {
      id: row.id,
      sessionId: row.session_id,
      taskId: row.task_id ?? undefined,
      agentId: row.agent_id ?? undefined,
      name: row.name,
      arguments: row.arguments,
      result: row.result ?? undefined,
      ok: row.ok === null ? undefined : row.ok === 1,
      createdAt: row.created_at,
      executed: row.executed === 1,
    };
  }

  recordApproval(input: {
    id: string;
    sessionId: string;
    taskId?: string;
    kind: string;
    subject: string;
    decision: string;
  }): void {
    this.db
      .query(
        `INSERT INTO approvals (id, session_id, task_id, kind, subject, decision, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(input.id, input.sessionId, input.taskId ?? null, input.kind, input.subject, input.decision, nowIso());
  }

  recordVerification(record: VerificationRecord): void {
    this.db
      .query(
        `INSERT INTO verifications (id, session_id, task_id, command, cwd, exit_code, duration_ms, output, truncated, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.sessionId,
        record.taskId ?? null,
        record.command,
        record.cwd,
        record.exitCode,
        record.durationMs,
        record.output,
        record.truncated ? 1 : 0,
        record.status,
        record.at,
      );
  }

  listVerifications(sessionId: string): VerificationRecord[] {
    const rows = this.db
      .query<
        {
          id: string;
          session_id: string;
          task_id: string | null;
          command: string;
          cwd: string;
          exit_code: number;
          duration_ms: number;
          output: string;
          truncated: number;
          status: VerificationRecord["status"];
          created_at: string;
        },
        [string]
      >("SELECT * FROM verifications WHERE session_id = ? ORDER BY created_at ASC")
      .all(sessionId);
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      taskId: row.task_id ?? undefined,
      command: row.command,
      cwd: row.cwd,
      exitCode: row.exit_code,
      durationMs: row.duration_ms,
      output: row.output,
      truncated: row.truncated === 1,
      status: row.status,
      at: row.created_at,
    }));
  }

  recordUsage(event: UsageEvent): void {
    this.db
      .query(
        `INSERT INTO usage_events (id, session_id, task_id, agent_id, provider_profile_id, model_id, input_tokens, output_tokens, total_tokens, requests, source, estimated_from, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.sessionId,
        event.taskId ?? null,
        event.agentId ?? null,
        event.providerProfileId,
        event.modelId,
        event.inputTokens,
        event.outputTokens,
        event.totalTokens,
        event.requests,
        event.source,
        event.estimatedFrom ?? null,
        event.at,
      );
  }

  listUsage(sessionId?: string): UsageEvent[] {
    const rows = sessionId
      ? this.db
          .query<Record<string, unknown>, [string]>("SELECT * FROM usage_events WHERE session_id = ? ORDER BY created_at ASC")
          .all(sessionId)
      : this.db.query<Record<string, unknown>, []>("SELECT * FROM usage_events ORDER BY created_at ASC").all();
    return rows.map((row) => ({
      id: String(row["id"]),
      at: String(row["created_at"]),
      sessionId: String(row["session_id"]),
      taskId: row["task_id"] ? String(row["task_id"]) : undefined,
      agentId: row["agent_id"] ? String(row["agent_id"]) : undefined,
      providerProfileId: String(row["provider_profile_id"]),
      modelId: String(row["model_id"]),
      inputTokens: Number(row["input_tokens"]),
      outputTokens: Number(row["output_tokens"]),
      totalTokens: Number(row["total_tokens"]),
      requests: Number(row["requests"]),
      source: row["source"] === "provider-reported" ? "provider-reported" : "estimated",
      estimatedFrom: row["estimated_from"] ? String(row["estimated_from"]) : undefined,
    }));
  }

  close(): void {
    this.db.close();
  }
}
