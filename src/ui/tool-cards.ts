import { truncateToWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import { fluxColor } from "./theme.js";
import { sanitizeUserFacingError } from "./ansi.js";

export type ToolCardStatus = "pending" | "running" | "updating" | "success" | "failed" | "denied" | "cancelled";

export interface ToolCardState {
  id: string;
  name: string;
  status: ToolCardStatus;
  messageIndex?: number;
  description: string;
  target?: string;
  command?: string;
  output?: string;
  error?: string;
  durationMs?: number;
  expanded: boolean;
}

const MAX_OUTPUT = 800;

export function describeTool(name: string, args: unknown): Pick<ToolCardState, "description" | "target" | "command"> {
  const record = isRecord(args) ? args : {};
  const path = typeof record.path === "string" ? record.path : undefined;
  const command = typeof record.command === "string" ? record.command : undefined;
  const description = name === "read"
    ? "Read workspace file"
    : name === "search"
      ? "Search workspace text"
      : name === "write"
        ? "Write workspace file"
        : name === "patch"
          ? "Apply file patch"
          : name === "shell"
            ? "Run bounded command"
            : "Execute workspace tool";
  return { description, ...(path ? { target: path } : {}), ...(command ? { command: sanitize(command, 240) } : {}) };
}

export function summarizeToolResult(result: unknown): { output?: string; error?: string } {
  if (!isRecord(result)) return {};
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content
    .filter((part) => isRecord(part) && part.type === "text" && typeof part.text === "string")
    .map((part) => String(part.text))
    .join("\n");
  const value = sanitize(text, MAX_OUTPUT);
  return result.isError === true ? { error: value || "Tool execution failed" } : { output: value };
}

export function sanitizeToolText(value: string, limit = MAX_OUTPUT): string {
  return sanitize(value, limit);
}

export function renderToolCards(cards: readonly ToolCardState[], width: number): string[] {
  return cards.flatMap((card) => renderToolCard(card, width));
}

export function renderToolCard(card: ToolCardState, width: number): string[] {
  const tone = card.status === "success" ? "success"
    : card.status === "failed" || card.status === "denied" ? "error"
      : card.status === "cancelled" || card.status === "pending" ? "warning"
        : "focus";
  const icon = card.status === "success" ? "✓"
    : card.status === "failed" || card.status === "denied" ? "×"
      : card.status === "cancelled" ? "■"
        : card.status === "updating" ? "↻"
          : card.status === "pending" ? "!"
            : "●";
  const meaning = card.status === "pending" ? "needs approval"
    : card.status === "running" ? "in progress"
      : card.status === "updating" ? "receiving output"
        : card.status === "success" ? "completed"
          : card.status === "failed" ? "failed"
            : card.status === "denied" ? "approval denied"
              : "cancelled";
  const target = card.target ? ` · ${card.target}` : card.command ? ` · ${card.command}` : "";
  const duration = card.durationMs === undefined ? "" : ` · ${card.durationMs}ms`;
  const title = ` ${icon} ${card.name.toUpperCase()}  ${card.status.toUpperCase()} · ${meaning}${duration}`;
  const innerWidth = Math.max(8, width - 5);
  const description = wrapTextWithAnsi(`${card.description}${target}`, innerWidth);
  const lines = [
    truncateToWidth(fluxColor(title, tone), Math.max(8, width - 1)),
    ...description.map((line) => ` ${fluxColor("│", "border")} ${fluxColor(line, "muted")}`),
  ];
  const detail = card.error ?? card.output;
  if (detail && (card.expanded || card.status === "failed" || card.status === "denied")) {
    lines.push(...detail.split(/\r?\n/).slice(0, 12).flatMap((line) =>
      wrapTextWithAnsi(line, innerWidth).map((part) =>
        ` ${fluxColor("│", "border")} ${fluxColor(part, card.error ? "error" : "assistant")}`)));
  } else if (detail) {
    lines.push(` ${fluxColor("│", "border")} ${fluxColor(truncateToWidth(detail.replace(/\s+/g, " "), innerWidth), "muted")}`);
  }
  if (card.expanded) lines.push(` ${fluxColor("└─", "border")} ${fluxColor("Ctrl+O collapse", "muted")}`);
  return lines;
}

export function toggleToolCard(card: ToolCardState): void {
  card.expanded = !card.expanded;
}

export class ToolCards implements Component {
  constructor(private readonly cards: readonly ToolCardState[], private readonly widthProvider: () => number) {}

  invalidate(): void {}

  render(width: number): string[] {
    return renderToolCards(this.cards, width || this.widthProvider());
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sanitize(value: string, limit: number): string {
  const redacted = sanitizeUserFacingError(value.replace(/((?:api[_-]?key|token|password|secret|authorization)\s*[:=]\s*)([^\s,;]+)/gi, "$1[redacted]"));
  return redacted.length > limit ? `${redacted.slice(0, Math.max(0, limit - 14))}… [truncated]` : redacted;
}

