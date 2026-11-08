import { execFile } from "node:child_process";
import { isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import {
  Editor,
  HStack,
  KeybindingsManager,
  ProcessTerminal,
  ScrollView,
  TUI_KEYBINDINGS,
  TuiAltScreen,
  VStack,
  matchesKey,
  setKeybindings,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
  type EditorTheme,
} from "@earendil-works/pi-tui";
import { SessionManager, type AgentSession, type AgentSessionEvent, type ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import type { FluxConfig } from "../config/providers.js";
import { createProviderRegistry, listOllamaModelIds } from "../providers/router.js";
import type { SessionStore } from "../sessions/records.js";
import type { ApprovalRequest } from "../safety/approval.js";
import type { ApprovalBroker } from "../tools/pi-tools.js";
import { answerWorkspaceQuestion, appendWorkspaceExchange } from "../agent/runtime-info.js";
import { PALETTE_COMMANDS, buildProviderModelGroups, createContextPresentation, isPaletteShortcut, listWorkspaceSessions, openWorkspaceSession, resolvePaletteCommand, type PaletteAction } from "./navigation.js";
import { InfoOverlay, SearchableSelect, SearchPrompt, type OverlayItem } from "./overlays.js";
import { createDiffSnapshot, renderDiff, type DiffSnapshot } from "./diff-view.js";
import { renderConversationTimeline, renderWelcomeScreen, truncateMiddle } from "./presentation.js";
import { renderFluxHeaderWordmark, shouldAnimateFluxLogo } from "./flux-logo.js";
import { fluxColor, fluxDesign, fluxSurface, shouldUseColor } from "./theme.js";
import { sanitizeUserFacingError } from "./ansi.js";
import {
  describeTool,
  renderToolCards,
  sanitizeToolText,
  summarizeToolResult,
  toggleToolCard,
  type ToolCardState,
} from "./tool-cards.js";

type MessageRole = "user" | "assistant" | "system";
const STARTER_PROMPTS = [
  "Explain this project.",
  "Find a bug in this codebase.",
  "Review the recent changes.",
  "Implement a feature I describe.",
] as const;

interface Message {
  role: MessageRole;
  content: string;
}

export interface FluxPiAppOptions {
  cwd: string;
  branch?: string;
  model: string;
  session: AgentSession;
  records: SessionStore;
  approvals: ApprovalBroker;
  config: FluxConfig;
  modelRuntime: ModelRuntime;
  createSession: (manager: SessionManager, model?: Model<any>) => Promise<{ session: AgentSession; records: SessionStore; initialError?: string }>;
  onSessionChange: (session: AgentSession) => void;
  searchFiles: (query: string) => Promise<Array<{ path: string; line: number; text: string }>>;
  initialError?: string;
}

export const FLUX_LAYOUT_CONSTRAINTS = {
  header: { basis: 3, shrink: 0 },
  transcript: { grow: 1, minSize: 1, shrink: 1 },
  composer: { basis: "auto" as const, minSize: 4, shrink: 0 },
  footer: { basis: 1, shrink: 0 },
} as const;

class FluxHeader implements Component {
  constructor(private readonly options: FluxPiAppOptions, private readonly state: FluxPiApp) {}

  invalidate(): void {}

  render(width: number): string[] {
    const project = this.options.cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? "workspace";
    const branch = this.options.branch ? ` · ${this.options.branch}` : "";
    const welcome = this.state.messages.length === 0 &&
      this.state.tools.length === 0 &&
      !this.state.diff &&
      !this.state.initialError;
    const status = this.state.approvalRequest
      ? { label: "APPROVAL", tone: "warning" as const }
      : this.state.busy
        ? { label: "GENERATING", tone: "focus" as const }
        : this.state.initialError
          ? { label: "ATTENTION", tone: "error" as const }
          : { label: "IDLE", tone: "muted" as const };
    const rule = fluxColor(truncateToWidth(` ${fluxDesign.symbols.divider.repeat(Math.max(0, width - 1))}`, width), "border");
    if (welcome) {
      const statusText = `${fluxColor("●", status.tone)} ${fluxColor(status.label, status.tone)}`;
      const detailWidth = Math.max(1, width - visibleWidth(statusText) - 6);
      const modelWidth = Math.max(1, Math.floor(detailWidth * 0.46));
      const projectWidth = Math.max(1, detailWidth - modelWidth);
      const projectText = truncateMiddle(`${project}${branch}`, projectWidth);
      const modelText = truncateMiddle(this.state.modelLabel, modelWidth);
      return [
        truncateToWidth(
          ` ${fluxColor(projectText, "secondary")}  ${fluxColor(modelText, "secondary")}  ${statusText}`,
          width,
        ),
        rule,
      ];
    }
    if (width < 40) {
      if (width < 24) {
        return [
          truncateToWidth(` FLUX · ${project}`, width),
          truncateToWidth(this.state.modelLabel, width),
          truncateToWidth(`${fluxColor("●", status.tone)} ${fluxColor(status.label, status.tone)}`, width),
        ];
      }
      const wordmark = renderFluxHeaderWordmark(this.state.animationFrame);
      const details = [`${project}${branch}`, this.state.modelLabel, `${status.label}`];
      const detailWidth = Math.max(0, width - visibleWidth(wordmark[0] ?? "") - 2);
      return wordmark.map((line, index) => truncateToWidth(
        `${line}  ${fluxColor(truncateMiddle(details[index] ?? "", detailWidth), index === 2 ? status.tone : "secondary")}`,
        width,
      ));
    }

    const wordmark = renderFluxHeaderWordmark(this.state.animationFrame);
    const rightRows = [
      fluxColor(`${project}${branch}`, "secondary"),
      fluxColor(this.state.modelLabel, "secondary"),
      `${fluxColor("●", status.tone)} ${fluxColor(status.label, status.tone)}`,
    ];
    const logoWidth = visibleWidth(wordmark[0] ?? "");
    const rightWidth = Math.max(1, width - logoWidth - 4);
    return wordmark.map((line, index) => {
      const left = ` ${line}  `;
      const right = truncateToWidth(rightRows[index] ?? "", rightWidth);
      const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
      return truncateToWidth(`${left}${" ".repeat(gap)}${right}`, width);
    });
  }
}

class FluxFooter {
  constructor(private readonly state: FluxPiApp) {}

  invalidate(): void {}

  render(width: number): string[] {
    const status = this.state.approvalRequest
      ? amber("● APPROVAL")
      : this.state.busy
        ? cyan("● GENERATING")
        : this.state.initialError
          ? coral("● ERROR")
          : muted("● IDLE");
    const hints = width < 46
      ? `${fluxColor("ACTIONS", "brand")} ${muted("Ctrl+K palette")}`
      : width < 76
        ? `${fluxColor("ACTIONS", "brand")} ${muted("Ctrl+K palette")} · ${muted("Ctrl+O details")}`
        : `${fluxColor("ACTIONS", "brand")} ${muted("Ctrl+K palette")} · ${muted("Ctrl+O details")}    ${fluxColor("SYSTEM", "brand")} ${muted("Ctrl+C exit")}`;
    const availableHints = Math.max(4, width - visibleWidth(status) - 3);
    const line = ` ${truncateToWidth(hints, availableHints)}  ${status}`;
    return [truncateToWidth(line, width)];
  }
}

export class FluxApprovalDialog implements Component {
  capturesViewportInput = true;
  private decision = 1;
  private previewOffset = 0;
  private canApprove = false;

  constructor(
    private readonly request: ApprovalRequest,
    private readonly cwd: string,
    private readonly onDecision: (approved: boolean) => void,
  ) {}

  get preferredWidth(): number {
    return Math.max(48, Math.min(84, visibleWidth(this.request.description) + 22));
  }

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(1, width);
    if (safeWidth < 20) {
      this.canApprove = false;
      return [
        truncateToWidth("Widen terminal to review", safeWidth),
        truncateToWidth("Esc denies request", safeWidth),
      ].slice(0, Number(process.stdout.rows) || 24);
    }
    const innerWidth = safeWidth - 4;
    const terminalRows = Number(process.stdout.rows) || 24;
    if (terminalRows < 9) {
      this.canApprove = false;
      return [
        modalTop(safeWidth),
        modalLine("Resize terminal to review the operation", innerWidth, "warning"),
        modalLine("Esc denies the operation", innerWidth, "muted"),
        modalBottom(safeWidth),
      ].slice(0, terminalRows);
    }
    this.canApprove = true;
    const compact = terminalRows < 16;
    const ultraCompact = terminalRows < 9;
    const preview = this.previewLines(innerWidth);
    const previewLimit = compact ? 1 : Math.max(2, Math.min(5, Math.floor((terminalRows - 14) / 2)));
    this.previewOffset = Math.min(this.previewOffset, Math.max(0, preview.length - previewLimit));
    const visiblePreview = preview.slice(this.previewOffset, this.previewOffset + previewLimit);
    const pathWidth = Math.max(1, innerWidth - 6);
    const target = this.request.path
      ? `File  ${shortenPath(workspaceRelativePath(this.cwd, this.request.path), pathWidth)}`
      : this.request.command
        ? `Command  ${sanitizeToolText(this.request.command, 240)}`
        : `Operation  ${this.request.operation}`;
    const description = wrapTextWithAnsi(sanitizeToolText(this.request.description, 400), innerWidth).slice(0, compact ? 1 : 2);
    return [
      modalTop(safeWidth),
      ...(terminalRows >= 6 ? [modalLine("╱╱  PERMISSION REQUIRED", innerWidth, "brand")] : []),
      modalLine(`${this.request.operation.toUpperCase()}  ·  ${this.request.path ? "WORKSPACE FILE" : "WORKSPACE OPERATION"}`, innerWidth, "warning"),
      modalLine(target, innerWidth, "primary"),
      ...(ultraCompact ? [] : description.map((line) => modalLine(line, innerWidth, "secondary"))),
      ...(!compact && !ultraCompact ? [modalLine("OPERATION PREVIEW", innerWidth, "brand")] : []),
      ...(ultraCompact ? [] : visiblePreview.map((line) => modalLine(line, innerWidth, previewTone(line)))),
      ...modalChoices(innerWidth, this.decision, terminalRows < 7),
      ...(!compact && !ultraCompact
        ? [modalLine("Y allow once · N deny · Esc cancel · ↑↓ choose", innerWidth, "muted")]
        : compact && safeWidth >= 30 && preview.length > previewLimit
          ? [modalLine("↑↓ preview · Y allow · N deny · Esc cancel", innerWidth, "muted")]
          : []),
      modalBottom(safeWidth),
    ];
  }

  handleInput(data: string): void {
    const terminalRows = Number(process.stdout.rows) || 24;
    if (matchesKey(data, "escape") || data.toLowerCase() === "n") {
      this.onDecision(false);
      return;
    }
    if (!this.canApprove || terminalRows < 5) return;
    if (data.toLowerCase() === "y") {
      this.onDecision(true);
      return;
    }
    if (matchesKey(data, "up") || matchesKey(data, "down") || matchesKey(data, "tab")) {
      this.decision = this.decision === 0 ? 1 : 0;
      return;
    }
    if (matchesKey(data, "pageUp")) this.previewOffset = Math.max(0, this.previewOffset - 5);
    if (matchesKey(data, "pageDown")) this.previewOffset += 5;
    if (matchesKey(data, "enter")) this.onDecision(this.decision === 0);
  }

  private previewLines(width: number): string[] {
    const value = this.request.preview !== undefined
      ? sanitizeToolText(this.request.preview, 4_000)
      : this.request.command
        ? `$ ${sanitizeToolText(this.request.command, 4_000)}`
        : "No content preview was supplied; review the operation and workspace path above.";
    const lines = value ? value.split(/\r?\n/) : ["(empty file content)"];
    return lines.flatMap((line) => wrapTextWithAnsi(
      this.request.operation === "write" ? `+ ${line}` : line,
      Math.max(1, width),
    ));
  }
}

class FluxComposer extends Editor {
  protected override renderTopBorder(width: number, hiddenLineCount: number): string {
    if (width < 24) return super.renderTopBorder(width, hiddenLineCount);
    const focusTone = this.focused ? "focus" : "border";
    const label = width < 38
      ? "MESSAGE · Enter"
      : "MESSAGE  Enter sends · Shift+Enter adds a line";
    const prefix = `${fluxColor("╭─ ", focusTone)}${fluxColor(truncateToWidth(label, Math.max(1, width - 6)), this.focused ? "brand" : "muted")} `;
    const scroll = hiddenLineCount > 0 ? `${fluxColor(`↑ ${hiddenLineCount} hidden`, "muted")}╮` : fluxColor("╮", "border");
    const fill = Math.max(0, width - visibleWidth(prefix) - visibleWidth(scroll));
    return truncateToWidth(`${prefix}${fluxColor("─".repeat(fill), "border")}${scroll}`, width);
  }

  protected override renderBottomBorder(width: number, linesBelow: number): string {
    const scroll = linesBelow > 0 ? ` ↓ ${linesBelow} hidden ` : "";
    const fill = Math.max(0, width - visibleWidth(scroll) - 2);
    const content = `╰${"─".repeat(fill)}${scroll}╯`;
    return fluxColor(truncateToWidth(content, width), "border");
  }
}

class ContextSidebar implements Component {
  constructor(private readonly state: FluxPiApp) {}

  invalidate(): void {}

  render(width: number): string[] {
    const files = changedFiles(this.state.diff);
    const lastTool = this.state.tools.at(-1);
    const firstPrompt = this.state.messages.find((message) => message.role === "user")?.content.replace(/\s+/g, " ").trim();
    const sessionName = this.state.sessionName?.trim();
    const sessionLabel = formatSidebarSessionLabel(sessionName, firstPrompt);
    const details = [
      ["SESSION", sessionLabel],
      ["MESSAGES", String(this.state.messages.length)],
      ["CHANGES", files.length ? files.slice(0, 3).join(", ") : this.state.diff ? "No current changes" : "Not inspected"],
      ["ACTIVITY", lastTool ? `${lastTool.name} · ${lastTool.status}` : "No tool activity"],
    ] as const;
    const rows = details.map(([label, value]) => {
      const key = `${label.padEnd(10)} `;
      const valueWidth = Math.max(1, width - visibleWidth(key) - 3);
      return `${fluxColor("│", "border")} ${fluxColor(key, "muted")}${fluxColor(truncateMiddle(value, valueWidth), "secondary")}`;
    });
    return [
      ` ${fluxColor("CONTEXT", "brand")}`,
      "",
      ...rows.slice(0, 2),
      "",
      rows[2]!,
      "",
      ...rows.slice(3),
    ]
      .map((line) => truncateToWidth(line, width));
  }
}

class Transcript implements Component {
  constructor(private readonly state: FluxPiApp, private readonly cwd: string) {}

  invalidate(): void {}

  render(width: number): string[] {
    const contentWidth = Math.min(104, Math.max(12, width - 4));
    const leftPadding = Math.max(0, Math.floor((width - contentWidth) / 2));
    const frame = this.state.animationFrame;
    const lines: string[] = [];
    if (this.state.messages.length === 0 && this.state.tools.length === 0 && !this.state.diff && !this.state.initialError) {
      return renderWelcomeScreen(Math.max(1, width - 2), frame)
        .map((line) => truncateToWidth(` ${line}`, width));
    }
    lines.push(...renderConversationTimeline(this.state.messages, this.state.tools, contentWidth));
    if (this.state.diff) lines.push(...renderDiff(this.state.diff, contentWidth));
    if (this.state.diffError) lines.push(` ${coral("Diff unavailable")} ${sanitizeUserFacingError(this.state.diffError)}`);
    if (this.state.initialError) {
      lines.push(` ${coral("!")} ${sanitizeUserFacingError(this.state.initialError)}`);
    }
    return lines.map((line) => `${" ".repeat(leftPadding)}${line}`);
  }
}

function createFluxEditorTheme(isFocused: () => boolean): EditorTheme {
  return {
    borderColor: (text) => fluxColor(text, isFocused() ? "focus" : "border"),
    selectList: {
      selectedPrefix: (text) => cyan(text),
      selectedText: (text) => cyan(text),
      description: (text) => muted(text),
      scrollInfo: (text) => muted(text),
      noMatch: (text) => coral(text),
    },
  };
}

function cyan(text: string): string {
  return fluxColor(text, "brand");
}

function amber(text: string): string {
  return fluxColor(text, "warning");
}

function green(text: string): string {
  return fluxColor(text, "success");
}

function coral(text: string): string {
  return fluxColor(text, "error");
}

function muted(text: string): string {
  return fluxColor(text, "muted");
}

function messageText(message: { role: string; content: unknown }): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((part): part is { type: "text"; text: string } => typeof part === "object" && part !== null && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

export class FluxPiApp {
  readonly terminal = new ProcessTerminal();
  readonly tui: TuiAltScreen;
  readonly messages: Message[] = [];
  readonly tools: ToolCardState[] = [];
  animationFrame = 0;
  busy = false;
  statusText = muted(" ready ");
  initialError?: string;
  approvalRequest?: ApprovalRequest;
  diff?: DiffSnapshot;
  diffError?: string;
  modelLabel: string;

  private readonly transcript: Transcript;
  private readonly editor: Editor;
  private unsubscribe: () => void;
  private assistantIndex: number | undefined;
  private pendingApproval?: { resolve: (approved: boolean) => void };
  private approvalCardId?: string;
  private currentSession: AgentSession;
  private currentRecords: SessionStore;
  private overlayHandle?: ReturnType<TuiAltScreen["showOverlay"]>;
  private animationTimer?: ReturnType<typeof setInterval>;
  private readonly animateLogo: boolean;
  private stopped = false;
  private resolveStopped!: () => void;
  private readonly stoppedPromise = new Promise<void>((resolve) => {
    this.resolveStopped = resolve;
  });

  constructor(private readonly options: FluxPiAppOptions) {
    this.animateLogo = shouldAnimateFluxLogo();
    this.initialError = options.initialError;
    this.currentSession = options.session;
    this.currentRecords = options.records;
    this.modelLabel = options.model;
    options.approvals.setHandler((request) => this.requestApproval(request));
    this.restoreMessages(options.session);

    this.tui = new TuiAltScreen(this.terminal, true, undefined, {
      mouse: true,
      scrollToEndIndicator: () => amber("  ↓ jump to latest "),
    });
    setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
    this.transcript = new Transcript(this, options.cwd);
    const scroll = new ScrollView(this.transcript, {
      follow: "end",
      primary: true,
      scrollbar: "auto",
      overscroll: "contain",
    });
    let editor: Editor | undefined;
    editor = new FluxComposer(this.tui, createFluxEditorTheme(() => editor?.focused ?? false), { paddingX: 1 });
    this.editor = editor;
    this.editor.onSubmit = (text) => void this.submit(text);
    const conversation = new HStack([
      { component: scroll, grow: 1, minSize: 1, shrink: 1 },
      {
        component: new ContextSidebar(this),
        basis: 46,
        shrink: 0,
        visible: (viewport) => shouldShowContextSidebar(viewport.width),
      },
    ], { gap: 0 });
    const root = new VStack(
      [
        { component: new FluxHeader(options, this), ...FLUX_LAYOUT_CONSTRAINTS.header },
        { component: conversation, ...FLUX_LAYOUT_CONSTRAINTS.transcript },
        { component: this.editor, ...FLUX_LAYOUT_CONSTRAINTS.composer },
        { component: new FluxFooter(this), ...FLUX_LAYOUT_CONSTRAINTS.footer },
      ],
      { gap: 0 },
    );
    this.tui.setLayoutRoot(root);
    this.tui.setFocus(this.editor);
    this.unsubscribe = options.session.subscribe((event) => this.handleEvent(event));
    this.tui.addInputListener((data) => this.handleInput(data));
  }

  get sessionId(): string {
    return this.currentSession.sessionId;
  }

  get sessionName(): string | undefined {
    return this.currentSession.sessionManager.getSessionName();
  }

  async run(): Promise<void> {
    this.tui.start();
    if (this.animateLogo) {
      this.animationTimer = setInterval(() => {
        this.animationFrame++;
        this.tui.requestRender();
      }, 125);
    }
    await this.stoppedPromise;
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.animationTimer) clearInterval(this.animationTimer);
    this.animationTimer = undefined;
    this.overlayHandle?.hide();
    this.overlayHandle = undefined;
    if (this.pendingApproval) {
      this.pendingApproval.resolve(false);
      this.pendingApproval = undefined;
      this.approvalRequest = undefined;
    }
    this.unsubscribe();
    this.tui.stop();
    this.resolveStopped();
  }

  private handleInput(data: string): { consume: boolean } | undefined {
    if (matchesKey(data, "ctrl+c")) {
      this.stop();
      return { consume: true };
    }
    if (isPaletteShortcut(data) && !this.overlayHandle && !this.pendingApproval) {
      this.openPalette();
      return { consume: true };
    }
    if (this.overlayHandle) return undefined;
    if (!this.busy && this.messages.length === 0) {
      const starterKeys = ["f1", "f2", "f3", "f4"] as const;
      const starterIndex = starterKeys.findIndex((key) => matchesKey(data, key));
      if (starterIndex >= 0) {
        void this.submit(STARTER_PROMPTS[starterIndex]!);
        return { consume: true };
      }
    }
    if (matchesKey(data, "ctrl+o")) {
      const last = this.tools.at(-1);
      if (last) {
        toggleToolCard(last);
        this.tui.requestRender();
      }
      return { consume: true };
    }
    if (this.pendingApproval) {
      const answer = data.toLowerCase();
      if (answer === "y") {
        void this.decideApproval(true);
        return { consume: true };
      }
      if (answer === "n" || matchesKey(data, "escape")) {
        void this.decideApproval(false);
        return { consume: true };
      }
    }
    if (matchesKey(data, "escape") && this.busy) {
      void this.currentSession.abort();
      this.statusText = amber(" interrupted ");
      this.tui.requestRender();
      return { consume: true };
    }
    return undefined;
  }

  private requestApproval(request: ApprovalRequest): Promise<boolean> {
    if (this.stopped) return Promise.resolve(false);
    if (this.pendingApproval) return Promise.resolve(false);
    this.approvalRequest = request;
    const protectedCard = [...this.tools].reverse().find((card) =>
      card.status === "running" && (card.name === "write" || card.name === "patch" || card.name === "shell"));
    this.approvalCardId = protectedCard?.id;
    if (protectedCard) protectedCard.status = "pending";
    this.showOverlay(new FluxApprovalDialog(request, this.options.cwd, (approved) => {
      void this.decideApproval(approved);
    }), { width: 76, maxHeight: "82%" });
    this.tui.requestRender();
    return new Promise<boolean>((resolve) => {
      this.pendingApproval = { resolve };
    });
  }

  private async decideApproval(approved: boolean): Promise<void> {
    const pending = this.pendingApproval;
    const request = this.approvalRequest;
    if (!pending || !request) return;
    this.pendingApproval = undefined;
    this.approvalRequest = undefined;
    this.closeOverlay();
    try {
      await this.currentRecords.recordApproval({
        sessionId: this.currentRecords.id,
        action: request.operation,
        decision: approved ? "approved" : "denied",
        reason: request.description,
      });
      this.statusText = approved ? amber(" approved ") : amber(" denied ");
      this.setApprovalCardStatus(approved ? "running" : "denied");
      pending.resolve(approved);
    } catch (error) {
      this.initialError = `Could not persist approval decision: ${error instanceof Error ? error.message : String(error)}`;
      this.statusText = coral(" error ");
      this.setApprovalCardStatus("denied");
      pending.resolve(false);
    }
    this.tui.requestRender();
  }

  private handleEvent(event: AgentSessionEvent): void {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      if (this.assistantIndex === undefined) {
        this.assistantIndex = this.messages.push({ role: "assistant", content: "" }) - 1;
      }
      this.messages[this.assistantIndex].content += event.assistantMessageEvent.delta;
      this.tui.requestRender();
      return;
    }
    if (event.type === "tool_execution_start") {
      this.tools.push({
        id: event.toolCallId,
        name: event.toolName,
        status: "running",
        messageIndex: Math.max(0, this.messages.length - 1),
        ...describeTool(event.toolName, event.args),
        expanded: false,
      });
      this.tui.requestRender();
      return;
    }
    if (event.type === "tool_execution_update") {
      const tool = this.tools.find((item) => item.id === event.toolCallId);
      if (tool) {
        tool.status = "updating";
        const update = summarizeToolResult(event.partialResult);
        tool.output = update.output ?? tool.output;
      }
      this.tui.requestRender();
      return;
    }
    if (event.type === "tool_execution_end") {
      const tool = this.tools.find((item) => item.id === event.toolCallId);
      if (tool) {
        const result = summarizeToolResult(event.result);
        if (tool.status !== "denied" && tool.status !== "cancelled") {
          tool.status = event.isError
            ? result.error?.toLowerCase().includes("approval") ? "denied" : "failed"
            : "success";
        }
        tool.output = result.output;
        tool.error = result.error;
        tool.durationMs = event.durationMs;
        if (!event.isError && (event.toolName === "write" || event.toolName === "patch")) {
          void this.refreshDiff(tool.target);
        }
        if (event.toolName === "shell" && tool.command) {
          void this.currentRecords.recordVerification({
            sessionId: this.currentRecords.id,
            command: tool.command,
            passed: !event.isError,
            output: result.output ?? result.error ?? "",
          }).catch((error: unknown) => {
            this.initialError = `Could not persist verification result: ${error instanceof Error ? error.message : String(error)}`;
            this.tui.requestRender();
          });
        }
      }
      this.tui.requestRender();
      return;
    }
    if (event.type === "agent_end") {
      const last = event.messages.at(-1);
      if (last?.role === "assistant" && last.stopReason === "error") {
        this.initialError = last.errorMessage ?? "Model request failed";
      }
      return;
    }
    if (event.type === "agent_settled") {
      this.busy = false;
      this.statusText = event.aborted ? amber(" interrupted ") : green(" ready ");
      if (event.aborted) {
        for (const tool of this.tools) {
          if (tool.status === "pending" || tool.status === "running" || tool.status === "updating") {
            tool.status = "cancelled";
          }
        }
      }
      this.assistantIndex = undefined;
      this.tui.requestRender();
    }
  }

  private setApprovalCardStatus(status: "running" | "denied"): void {
      if (!this.approvalCardId) return;
      const card = this.tools.find((item) => item.id === this.approvalCardId);
      if (card) card.status = status;
      this.approvalCardId = undefined;
    }

  private async refreshDiff(target?: string): Promise<void> {
      try {
        const args = ["--no-pager", "diff", "--no-color", "--", ...(target ? [target] : [])];
        const result = await promisify(execFile)("git", args, { cwd: this.options.cwd, maxBuffer: 128 * 1024 });
        this.diff = createDiffSnapshot(result.stdout);
        this.diffError = undefined;
      } catch (error) {
        this.diff = undefined;
        this.diffError = error instanceof Error ? error.message : String(error);
      }
      this.tui.requestRender();
  }

  private async submit(text: string): Promise<void> {
    const prompt = text.trim();
    if (!prompt || this.busy) return;
    this.editor.addToHistory(prompt);
    this.messages.push({ role: "user", content: prompt });
    this.assistantIndex = undefined;
    this.busy = true;
    this.statusText = amber(" streaming ");
    this.tui.requestRender();
    try {
      await this.currentRecords.appendMessage({ role: "user", content: prompt });
      const runtimeAnswer = answerWorkspaceQuestion(prompt, this.options.cwd);
      if (runtimeAnswer) {
        appendWorkspaceExchange(this.currentSession, prompt, runtimeAnswer);
        await this.currentRecords.appendMessage({ role: "assistant", content: runtimeAnswer });
        this.messages.push({ role: "assistant", content: runtimeAnswer });
        this.busy = false;
        this.statusText = green(" ready ");
        this.tui.requestRender();
        return;
      }
      await this.currentSession.prompt(prompt);
      await this.currentRecords.appendMessage({ role: "system", content: "FLUX completed the prompt." });
    } catch (error) {
      this.initialError = error instanceof Error ? error.message : String(error);
      this.busy = false;
      this.statusText = coral(" error ");
      this.tui.requestRender();
    }
  }

  private restoreMessages(session: AgentSession): void {
    this.messages.length = 0;
    for (const message of session.messages) {
      if (message.role === "user" || message.role === "assistant") {
        this.messages.push({ role: message.role, content: messageText(message) });
      }
    }
  }

  private showOverlay(component: Component, options: { width?: number; maxHeight?: `${number}%` } = {}): void {
    this.overlayHandle?.hide();
    const width = options.width ??
      (component instanceof SearchableSelect || component instanceof SearchPrompt ||
        component instanceof InfoOverlay || component instanceof FluxApprovalDialog
        ? component.preferredWidth
        : 64);
    this.overlayHandle = this.tui.showOverlay(component, {
      width,
      maxHeight: options.maxHeight ?? "76%",
      margin: 1,
      anchor: "center",
    });
    this.overlayHandle.focus();
    this.tui.requestRender();
  }

  private closeOverlay(): void {
    this.overlayHandle?.hide();
    this.overlayHandle = undefined;
    this.tui.setFocus(this.editor);
    this.tui.requestRender();
  }

  private openPalette(): void {
    const items: OverlayItem[] = PALETTE_COMMANDS.map((command) => ({
      value: command.action,
      label: command.label,
      category: command.category,
      description: command.description,
      shortcut: "Enter",
      searchText: `${command.action} ${command.category} ${command.label} ${command.description}`,
    }));
    this.showOverlay(new SearchableSelect(
      "Command palette",
      items,
      (item) => {
        const command = resolvePaletteCommand(item.value);
        if (!command) {
          this.showInfo("Unavailable action", ["The selected action is not available."]);
          return;
        }
        this.closeOverlay();
        void this.executeCommand(command.action);
      },
      () => this.closeOverlay(),
    ));
  }

  private async executeCommand(action: PaletteAction): Promise<void> {
    try {
      switch (action) {
        case "new-session":
          await this.createNewSession();
          break;
        case "switch-session":
        case "resume-session":
          await this.openSessionPicker(action === "resume-session");
          break;
        case "search-files":
          this.showOverlay(new SearchPrompt(
            (query) => {
              this.closeOverlay();
              void this.searchWorkspace(query);
            },
            () => this.closeOverlay(),
          ));
          break;
        case "show-diff":
          await this.refreshDiff();
          this.showInfo("Workspace diff", this.diffError
            ? [`Diff unavailable: ${this.diffError}`]
            : this.diff?.text.split(/\r?\n/) ?? ["No workspace diff."]);
          break;
        case "show-status":
          this.showInfo("FLUX status", [
            `Project: ${this.options.cwd}`,
            `Model: ${this.modelLabel}`,
            `Session: ${formatSidebarSessionLabel(this.sessionName, this.messages.find((message) => message.role === "user")?.content)} (${shortSessionId(this.currentSession.sessionId)})`,
            `Persistence: ${this.currentSession.sessionManager.isPersisted() ? "saved" : "pending"}`,
            `Messages: ${this.currentSession.messages.length}`,
          ]);
          break;
        case "show-context":
          await this.showContext();
          break;
        case "select-model":
          await this.openModelSelector();
          break;
        case "help":
          this.showInfo("FLUX help", [
            "Ctrl+K  open command palette",
            "Enter  send message or select",
            "Shift+Enter  insert newline",
            "Up/Down  navigate and scroll",
            "Esc  close overlay or interrupt a response",
            "Ctrl+O  expand/collapse last tool card",
            "Ctrl+C  exit",
          ]);
          break;
        case "exit":
          this.stop();
          break;
      }
    } catch (error) {
      this.showInfo("Action failed", [error instanceof Error ? error.message : String(error)]);
    }
  }

  private async createNewSession(): Promise<void> {
    await this.replaceSession(
      SessionManager.create(this.options.cwd, this.currentSession.sessionManager.getSessionDir()),
      this.currentSession.model,
    );
  }

  private async openSessionPicker(resume: boolean): Promise<void> {
    if (this.busy) {
      this.showInfo("Session unavailable", ["Wait for the current response to finish before switching sessions."]);
      return;
    }
    let sessions;
    try {
      sessions = await listWorkspaceSessions(
        this.options.cwd,
        this.currentSession.sessionManager.getSessionDir(),
      );
    } catch (error) {
      this.showInfo("Sessions unavailable", [error instanceof Error ? error.message : String(error)]);
      return;
    }
    const currentPath = this.currentSession.sessionManager.getSessionFile();
    const matching = sessions.filter((session) => session.path !== currentPath);
    const itemByValue = new Map<string, typeof matching[number]>();
    const items = matching.map((session) => {
      const value = `${session.id} ${session.name ?? ""} ${session.firstMessage} ${session.allMessagesText}`;
      itemByValue.set(value, session);
      return {
        value,
        label: session.name || session.firstMessage.slice(0, 64) || "Untitled session",
        category: "Session",
        description: `${session.messageCount} messages · ${session.modified.toLocaleString()} · ${shortSessionId(session.id)}`,
        shortcut: "Enter",
        searchText: session.allMessagesText,
      };
    });
    if (items.length === 0) {
      this.showInfo(resume ? "Resume session" : "Switch session", ["No other sessions exist for this workspace."]);
      return;
    }
    this.showOverlay(new SearchableSelect(
      resume ? "Resume session" : "Switch session",
      items,
      (item) => {
        const selected = itemByValue.get(item.value);
        this.closeOverlay();
        if (selected) void this.openExistingSession(selected.path);
      },
      () => this.closeOverlay(),
    ));
  }

  private async openExistingSession(sessionFile: string): Promise<void> {
    try {
      const manager = await openWorkspaceSession(
        sessionFile,
        this.options.cwd,
        this.currentSession.sessionManager.getSessionDir(),
      );
      await this.replaceSession(manager);
    } catch (error) {
      this.showInfo("Could not resume session", [error instanceof Error ? error.message : String(error)]);
    }
  }

  private async replaceSession(manager: SessionManager, model?: Model<any>): Promise<void> {
    if (this.busy || this.pendingApproval) {
      this.showInfo("Session unavailable", ["Finish the active operation before switching sessions."]);
      return;
    }
    const previous = this.currentSession;
    try {
      await previous.waitForIdle();
      const next = await this.options.createSession(manager, model);
      const unsubscribe = next.session.subscribe((event) => this.handleEvent(event));
      this.unsubscribe();
      this.currentSession = next.session;
      this.currentRecords = next.records;
      this.unsubscribe = unsubscribe;
      this.options.onSessionChange(next.session);
      this.restoreMessages(next.session);
      this.tools.length = 0;
      this.assistantIndex = undefined;
      this.initialError = next.initialError;
      this.modelLabel = next.session.model ? `${next.session.model.provider}/${next.session.model.id}` : "not configured";
      this.statusText = green(" ready ");
      this.tui.requestRender();
      previous.dispose();
    } catch (error) {
      this.showInfo("Could not switch session", [error instanceof Error ? error.message : String(error)]);
    }
  }

  private async openModelSelector(): Promise<void> {
    const ollamaModelIds = await listOllamaModelIds(this.options.config);
    if (ollamaModelIds !== undefined) {
      const provider = createProviderRegistry(this.options.config, { ollamaModelIds })
        .getProviders()
        .find((candidate) => candidate.id === "ollama");
      if (provider) this.options.modelRuntime.registerNativeProvider(provider);
    }
    const groups = buildProviderModelGroups(this.options.config, this.currentSession.model, ollamaModelIds);
    const candidates = new Map<string, Model<any>>();
    const items: OverlayItem[] = [];
    for (const group of groups) {
      const authStatus = group.provider === "ollama"
        ? "local endpoint"
        : this.options.modelRuntime.getProviderAuthStatus(group.provider);
      const authLabel = typeof authStatus === "string"
        ? authStatus
        : authStatus.configured
          ? `auth configured${authStatus.source ? ` (${authStatus.source})` : ""}`
          : "auth unavailable";
      if (group.models.length === 0) {
        items.push({
          value: `unavailable:${group.provider}`,
          label: group.provider,
          category: "Unavailable provider",
          description: `${group.description} · ${authLabel}`,
          searchText: group.provider,
          disabled: true,
        });
      }
      for (const entry of group.models) {
        const modelId = entry.modelId;
        const value = modelId ? `${group.provider}/${modelId}` : `unavailable:${group.provider}`;
        const model = modelId && entry.available && this.options.config.providers[group.provider]?.enabled
          ? this.options.modelRuntime.getModel(group.provider, modelId)
          : undefined;
        if (model) candidates.set(value, model);
        items.push({
          value,
          label: `${modelId ?? "No model configured"}${entry.active ? "  · ACTIVE" : ""}`,
          category: group.provider,
          description: `${entry.available ? entry.description : "Not installed"} · ${authLabel}`,
          shortcut: model && !entry.active ? "Enter" : undefined,
          searchText: `${group.provider} ${entry.description}`,
          disabled: !model,
        });
      }
    }
    this.showOverlay(new SearchableSelect(
      "Select model · providers",
      items,
      (item) => {
        const model = candidates.get(item.value);
        if (!model) {
          this.showInfo("Model unavailable", [item.description ?? "This provider or model is not configured."]);
          return;
        }
        this.closeOverlay();
        void this.selectModel(model);
      },
      () => this.closeOverlay(),
    ));
  }

  private async selectModel(model: Model<any>): Promise<void> {
    const previous = this.currentSession.model;
    try {
      await this.currentSession.setModel(model);
      this.modelLabel = this.currentSession.model
        ? `${this.currentSession.model.provider}/${this.currentSession.model.id}`
        : "not configured";
      this.initialError = undefined;
      this.statusText = green(" model switched ");
      this.tui.requestRender();
    } catch (error) {
      if (this.currentSession.model !== previous) {
        this.modelLabel = previous ? `${previous.provider}/${previous.id}` : "not configured";
      }
      this.showInfo("Model switch failed", [error instanceof Error ? error.message : String(error)]);
    }
  }

  private async searchWorkspace(query: string): Promise<void> {
    try {
      const matches = await this.options.searchFiles(query);
      const lines = matches.length
        ? matches.map((match) => `${match.path}:${match.line}  ${match.text}`)
        : [`No matches for "${query}".`];
      this.showInfo("Search results", lines);
    } catch (error) {
      this.showInfo("Search failed", [error instanceof Error ? error.message : String(error)]);
    }
  }

  private async showContext(): Promise<void> {
    try {
      const record = await this.currentRecords.load();
      const context = createContextPresentation({
        project: this.options.cwd,
        sessionId: `${formatSidebarSessionLabel(this.sessionName, this.messages.find((message) => message.role === "user")?.content)} (${shortSessionId(this.currentSession.sessionId)})`,
        model: this.modelLabel,
        messageCount: this.currentSession.messages.length,
        context: this.currentSession.getContextUsage(),
        persisted: this.currentSession.sessionManager.isPersisted(),
      });
      const usage = context.context && context.context.tokens !== null
        ? `Context: ~${context.context.tokens} / ${context.context.contextWindow} tokens${context.context.percent === null ? "" : ` (${context.context.percent}%)`}`
        : "Context usage: unavailable";
      this.showInfo("Context and session", [
        `Project: ${context.project}`,
        `Session: ${context.session}`,
        `Model: ${context.model}`,
        `Conversation messages: ${context.messageCount}`,
        usage,
        `Persistence: ${context.persistence}`,
        `Approvals: ${record.approvals.length}`,
        `Verification records: ${record.verifications.length}`,
      ]);
    } catch (error) {
      this.showInfo("Context unavailable", [error instanceof Error ? error.message : String(error)]);
    }
  }

  private showInfo(title: string, lines: readonly string[]): void {
    this.showOverlay(new InfoOverlay(title, lines.map(sanitizeUserFacingError), () => this.closeOverlay()));
  }
}

function workspaceRelativePath(cwd: string, value: string): string {
  const root = resolve(cwd);
  const target = resolve(cwd, value);
  const relativePath = relative(root, target);
  if (relativePath === "") return ".";
  if (relativePath === ".." || relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(relativePath)) {
    return `Outside workspace · ${sanitizeToolText(value, 240)}`;
  }
  return sanitizeToolText(relativePath, 240);
}

export function shouldShowContextSidebar(width: number): boolean {
  return width >= 132;
}

export function formatSidebarSessionLabel(name: string | undefined, firstPrompt: string | undefined): string {
  return sanitizeToolText(name?.trim() || firstPrompt?.slice(0, 80) || "New session", 120);
}

function shortSessionId(sessionId: string): string {
  return sessionId.replace(/-/g, "").slice(0, 8);
}

function shortenPath(value: string, width: number): string {
  if (visibleWidth(value) <= width) return value;
  const basename = value.split(/[\\/]/).at(-1) ?? value;
  if (visibleWidth(basename) >= width) return `…${tailToWidth(basename, Math.max(0, width - 1))}`;
  return truncateMiddle(value, width);
}

function tailToWidth(value: string, width: number): string {
  let result = "";
  for (const character of Array.from(value).reverse()) {
    const candidate = `${character}${result}`;
    if (visibleWidth(candidate) > width) break;
    result = candidate;
  }
  return result;
}

function changedFiles(diff: DiffSnapshot | undefined): string[] {
  if (!diff) return [];
  return [...new Set(diff.text.split(/\r?\n/)
    .filter((line) => line.startsWith("+++ b/"))
    .map((line) => line.slice(6))
    .filter((file) => file !== "/dev/null"))];
}

function modalTop(width: number): string {
  if (width < 4) return truncateToWidth("FLUX", width);
  const label = fluxColor(truncateToWidth("╱╱  FLUX PERMISSIONS", Math.max(1, width - 3)), "brand");
  const fill = Math.max(0, width - visibleWidth(label) - 3);
  return `${fluxColor("╭─", "border")}${label}${fluxColor("─".repeat(fill), "border")}${fluxColor("╮", "border")}`;
}

function modalLine(value: string, width: number, tone: Parameters<typeof fluxColor>[1]): string {
  if (width < 4) return truncateToWidth(value, width);
  return fluxSurface(`${fluxColor("│", "border")} ${fluxColor(truncateToWidth(value, width), tone)} ${fluxColor("│", "border")}`);
}

function modalBottom(width: number): string {
  if (width < 2) return truncateToWidth("╰╯", width);
  return fluxColor(`╰${"─".repeat(Math.max(0, width - 2))}╯`, "border");
}

function modalChoices(width: number, decision: number, forceSingleLine = false): string[] {
  const left = "[Y] Allow once";
  const right = "[N] Deny";
  if (forceSingleLine) {
    const compactLeft = choice("Y", decision === 0);
    const compactRight = choice("N", decision === 1);
    return [modalLine(`${compactLeft}  ${compactRight}`, width, "primary")];
  }
  if (width < 30) {
    return [
      modalLine(choice(left, decision === 0), width, "primary"),
      modalLine(choice(right, decision === 1), width, "primary"),
    ];
  }
  const leftChoice = choice(left, decision === 0);
  const rightChoice = choice(right, decision === 1);
  const gap = Math.max(1, width - visibleWidth(leftChoice) - visibleWidth(rightChoice));
  const content = `${leftChoice}${" ".repeat(gap)}${rightChoice}`;
  return [`${fluxColor("│", "border")} ${truncateToWidth(content, width)} ${fluxColor("│", "border")}`];
}

function choice(value: string, selected: boolean): string {
  if (!selected || !shouldUseColor()) return selected ? `> ${value}` : `  ${value}`;
  return `\u001b[48;5;${fluxDesign.colors.selection}m\u001b[38;5;255m> ${value}\u001b[0m`;
}

function previewTone(line: string): Parameters<typeof fluxColor>[1] {
  if (line.startsWith("+")) return "success";
  if (line.startsWith("-")) return "error";
  if (line.startsWith("@@")) return "brand";
  return "secondary";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
