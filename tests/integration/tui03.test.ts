import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, test } from "bun:test";
import { buildProviderModelGroups, createContextPresentation, filterSearchable, isPaletteShortcut, listWorkspaceSessions, openWorkspaceSession, PALETTE_COMMANDS, resolvePaletteCommand, sameWorkspacePath } from "../../src/ui/navigation.js";
import { InfoOverlay, SearchableSelect, type OverlayItem } from "../../src/ui/overlays.js";
import { createProviderRegistry, routeModel } from "../../src/providers/router.js";
import type { FluxConfig } from "../../src/config/providers.js";
import { SessionStore } from "../../src/sessions/records.js";

const config: FluxConfig = {
  defaultProvider: "ollama",
  defaultModel: "qwen3.5:9b",
  providers: {
    ollama: {
      name: "ollama",
      model: "qwen3.5:9b",
      baseUrl: "http://127.0.0.1:11434/v1",
      enabled: true,
    },
    "openai-compatible": {
      name: "openai-compatible",
      model: "configured-chat",
      baseUrl: "https://example.invalid/v1",
      enabled: true,
    },
    bharatcode: {
      name: "bharatcode",
      model: "bharatcode",
      baseUrl: "https://example.invalid/v1",
      enabled: false,
    },
  },
};

describe("TUI-03 navigation", () => {
  test("opens the command palette with Ctrl+K and closes it with Escape", () => {
    expect(isPaletteShortcut("\u000b")).toBe(true);
    expect(isPaletteShortcut("k")).toBe(false);
    let cancelled = false;
    const select = new SearchableSelect(
      "Command palette",
      [{ value: "status", label: "Show status", description: "Show current state" }],
      () => undefined,
      () => { cancelled = true; },
    );
    select.handleInput("\u001b");
    expect(cancelled).toBe(true);
  });

  test("filters palette commands with substring and fuzzy matching; no arbitrary shell action exists", () => {
    expect(filterSearchable(PALETTE_COMMANDS, "model").map((command) => command.action)).toContain("select-model");
    expect(filterSearchable(PALETTE_COMMANDS, "shst").map((command) => command.action)).toContain("show-status");
    expect(resolvePaletteCommand("run-shell")).toBeUndefined();
    expect(PALETTE_COMMANDS.some((command) => command.action === "search-files")).toBe(true);
  });

  test("executes a selected command and reports empty results", () => {
    let selected: string | undefined;
    const items: OverlayItem[] = [
      { value: "show-status", label: "Show status", description: "Current state" },
      { value: "exit", label: "Exit", description: "Close FLUX" },
    ];
    const select = new SearchableSelect("Commands", items, (item) => { selected = item.value; }, () => undefined);
    select.handleInput("\u001b[B");
    select.handleInput("\r");
    expect(selected).toBe("exit");

    select.handleInput("z");
    select.handleInput("z");
    expect(select.render(16).join("\n")).toContain("No results");
  });

  test("model selector groups configured providers and marks active and unavailable models", () => {
    const groups = buildProviderModelGroups(config, { provider: "ollama", id: "qwen3.5:9b" }, ["qwen3.5:9b", "qwen2.5:7b"]);
    expect(groups.map((group) => group.provider)).toEqual(["ollama", "openai-compatible", "bharatcode"]);
    expect(groups[0]?.models.map((model) => model.modelId)).toEqual(["qwen3.5:9b", "qwen2.5:7b"]);
    expect(groups[0]?.models[0]?.active).toBe(true);
    expect(groups[2]?.available).toBe(false);
    expect(groups.length).toBe(3);
    const unavailableCatalog = buildProviderModelGroups(config, { provider: "ollama", id: "llama3.2" });
    expect(unavailableCatalog[0]?.available).toBe(false);
    expect(unavailableCatalog[0]?.description).toContain("endpoint unavailable");
  });

  test("switches using AgentSession.setModel and leaves the active model unchanged on failure", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flux-tui03-model-"));
    const runtime = await ModelRuntime.create({ refreshOnCreate: false });
    for (const provider of createProviderRegistry(config).getProviders()) runtime.registerNativeProvider(provider);
    const current = runtime.getModel("ollama", "qwen3.5:9b");
    const denied = runtime.getModel("openai-compatible", "configured-chat");
    if (!current || !denied) throw new Error("Configured test provider models were not registered.");
    const { session } = await createAgentSession({
      cwd: root,
      modelRuntime: runtime,
      model: current,
      sessionManager: SessionManager.inMemory(root),
      noTools: "all",
    });
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      await session.setModel(routeModel(config, "ollama", "qwen2.5:7b").model);
      expect(session.model?.id).toBe("qwen2.5:7b");
      await expect(session.setModel(denied)).rejects.toThrow();
      expect(session.model?.id).toBe("qwen2.5:7b");
    } finally {
      if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousOpenAiKey;
      session.dispose();
    }
  });
});

describe("TUI-03 session management", () => {
  test("creates, lists, filters, switches, and resumes sessions with their history", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flux-tui03-sessions-"));
    const cwd = path.join(root, "project");
    const sessionDir = path.join(root, "pi-sessions");
    await mkdir(cwd);
    const original = SessionManager.create(cwd, sessionDir);
    original.appendMessage({ role: "user", content: "Remember the migration checklist." });
    original.appendMessage({ role: "assistant", content: "The checklist is saved." });
    const originalPath = original.getSessionFile();
    if (!originalPath) throw new Error("Pi did not persist the conversation session.");
    const info = await listWorkspaceSessions(cwd, sessionDir);
    expect(info).toHaveLength(1);
    expect(filterSearchable(info.map((session) => ({
      label: session.name ?? session.id,
      description: session.firstMessage,
      searchText: session.allMessagesText,
    })), "migration")[0]?.description).toContain("migration");

    const fresh = SessionManager.create(cwd, sessionDir);
    expect(fresh.getSessionId()).not.toBe(original.getSessionId());
    const resumed = await openWorkspaceSession(originalPath, cwd, sessionDir);
    expect(resumed.getSessionId()).toBe(original.getSessionId());
    expect(resumed.buildSessionContext().messages.map((message) => message.content).join(" ")).toContain("migration checklist");
  });

  test("isolates session lists by workspace and compares Windows-style paths safely", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flux-tui03-isolation-"));
    const firstCwd = path.join(root, "first");
    const secondCwd = path.join(root, "second");
    const firstDir = path.join(root, "sessions-first");
    const secondDir = path.join(root, "sessions-second");
    await mkdir(firstCwd);
    await mkdir(secondCwd);
    const first = SessionManager.create(firstCwd, firstDir);
    first.appendMessage({ role: "user", content: "first workspace only" });
    const second = SessionManager.create(secondCwd, secondDir);
    second.appendMessage({ role: "user", content: "second workspace only" });
    expect((await listWorkspaceSessions(firstCwd, firstDir)).map((session) => session.cwd)).toEqual([firstCwd]);
    expect((await listWorkspaceSessions(secondCwd, secondDir)).map((session) => session.cwd)).toEqual([secondCwd]);
    const secondFile = second.getSessionFile();
    if (!secondFile) throw new Error("The second workspace session was not persisted.");
    const sessionLines = (await readFile(secondFile, "utf8")).split(/\r?\n/);
    const header = JSON.parse(sessionLines[0]!) as Record<string, unknown>;
    delete header.cwd;
    await writeFile(secondFile, [JSON.stringify(header), ...sessionLines.slice(1)].join("\n"), "utf8");
    expect(await listWorkspaceSessions(secondCwd, secondDir)).toEqual([]);
    expect(sameWorkspacePath("C:\\Work\\Flux\\", "c:/work/flux")).toBe(process.platform === "win32");
    expect(sameWorkspacePath(firstCwd, secondCwd)).toBe(false);
  });

  test("rejects missing, corrupt, and cross-workspace session files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flux-tui03-invalid-"));
    const cwd = path.join(root, "project");
    const sessionDir = path.join(root, "sessions");
    const otherDir = path.join(root, "other-sessions");
    await mkdir(cwd);
    await mkdir(otherDir);
    const corrupt = path.join(sessionDir, "corrupt.jsonl");
    await mkdir(sessionDir);
    await writeFile(corrupt, "{not json\n", "utf8");
    await expect(openWorkspaceSession(corrupt, cwd, sessionDir)).rejects.toThrow();
    await expect(openWorkspaceSession(path.join(sessionDir, "missing.jsonl"), cwd, sessionDir)).rejects.toThrow();
    await expect(openWorkspaceSession(path.join(sessionDir, "missing-current-cwd.jsonl"), process.cwd(), sessionDir))
      .rejects.toThrow("no longer exists");
    expect(await listWorkspaceSessions(cwd, path.join(root, "no-sessions"))).toEqual([]);
    const other = SessionManager.create(path.join(root, "other-project"), otherDir);
    other.appendMessage({ role: "user", content: "other project" });
    const otherFile = other.getSessionFile();
    if (!otherFile) throw new Error("Pi did not persist the other-workspace session.");
    await expect(openWorkspaceSession(otherFile, cwd, sessionDir)).rejects.toThrow();
  });

  test("keeps approval and verification records attached to their session", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "flux-tui03-evidence-"));
    const records = new SessionStore("session-evidence", directory, directory);
    await records.recordApproval({ sessionId: records.id, action: "write", decision: "approved" });
    await records.recordVerification({ sessionId: records.id, command: "bun test", passed: true, output: "passed" });
    const recovered = await new SessionStore(records.id, directory, directory).load();
    expect(recovered.approvals).toHaveLength(1);
    expect(recovered.verifications[0]?.passed).toBe(true);
  });

  test("presents known context metadata without inventing token usage", () => {
    const presentation = createContextPresentation({
      project: "workspace",
      sessionId: "session-id",
      model: "ollama/qwen",
      messageCount: 3,
      persisted: false,
    });
    expect(presentation.context).toBeUndefined();
    expect(presentation.messageCount).toBe(3);
    expect(presentation.persistence).toBe("Not persisted yet");
  });

  test("keeps keyboard overlays usable at small terminal widths", () => {
    const overlay = new InfoOverlay("Status", ["line one", "line two"], () => undefined);
    expect(overlay.render(12).length).toBeLessThanOrEqual(20);
    const select = new SearchableSelect("Models", [
      { value: "ollama/qwen", label: "Ollama · qwen", description: "Active" },
    ], () => undefined, () => undefined);
    expect(select.render(12).length).toBeGreaterThan(1);
    select.handleInput("\u001b[B");
    select.handleInput("\u001b");
  });
});
