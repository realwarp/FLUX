// Durable session, approval, and verification records.
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { defaultDataDirectory, LocalJsonStore } from "../persistence/local-store.js";

export interface SessionMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  createdAt: string;
}

export interface ApprovalRecord {
  id: string;
  sessionId: string;
  action: string;
  decision: "approved" | "denied";
  createdAt: string;
  reason?: string;
}

export interface VerificationRecord {
  id: string;
  sessionId: string;
  command: string;
  passed: boolean;
  output: string;
  createdAt: string;
}

export interface SessionRecord {
  id: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  messages: SessionMessage[];
  approvals: ApprovalRecord[];
  verifications: VerificationRecord[];
}

/** Stores complete session snapshots using atomic replacement, safe across relaunches. */
export class SessionStore {
  private readonly store: LocalJsonStore<SessionRecord>;

  constructor(
    private readonly sessionId: string = randomUUID(),
    dataDirectory = defaultDataDirectory(),
    cwd = process.cwd(),
  ) {
    this.store = new LocalJsonStore(join(dataDirectory, "sessions", `${sessionId}.json`), {
      id: sessionId,
      cwd,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
      approvals: [],
      verifications: [],
    });
  }

  get id(): string {
    return this.sessionId;
  }

  load(): Promise<SessionRecord> {
    return this.store.read();
  }

  async appendMessage(message: Omit<SessionMessage, "id" | "createdAt">): Promise<SessionMessage> {
    const record = await this.store.read();
    const saved = { ...message, id: randomUUID(), createdAt: new Date().toISOString() };
    await this.store.write({ ...record, updatedAt: saved.createdAt, messages: [...record.messages, saved] });
    return saved;
  }

  async recordApproval(input: Omit<ApprovalRecord, "id" | "createdAt">): Promise<ApprovalRecord> {
    const record = await this.store.read();
    const saved = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    await this.store.write({ ...record, updatedAt: saved.createdAt, approvals: [...record.approvals, saved] });
    return saved;
  }

  async recordVerification(input: Omit<VerificationRecord, "id" | "createdAt">): Promise<VerificationRecord> {
    const record = await this.store.read();
    const saved = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    await this.store.write({ ...record, updatedAt: saved.createdAt, verifications: [...record.verifications, saved] });
    return saved;
  }
}
