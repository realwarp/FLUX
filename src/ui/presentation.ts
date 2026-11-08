import { Markdown, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { MarkdownTheme } from "@earendil-works/pi-tui";
import { fluxCodeBlock, fluxColor, fluxDesign, type FluxTone } from "./theme.js";
import { renderFluxPixelLogo } from "./flux-logo.js";
import { renderToolCards, type ToolCardState } from "./tool-cards.js";

export type PresentationRole = "user" | "assistant" | "system";

const starterActions = [
  { key: "F1", label: "Explain this project" },
  { key: "F2", label: "Find a bug" },
  { key: "F3", label: "Review recent changes" },
  { key: "F4", label: "Implement a feature" },
] as const;

export function renderWelcomeScreen(width: number, frame = 0): string[] {
  const safeWidth = Math.max(1, width);
  const contentWidth = Math.max(20, Math.min(82, safeWidth - 4));
  const inset = Math.max(0, Math.floor((safeWidth - contentWidth) / 2));
  const logoScale = contentWidth >= 46 ? 2 : 1;
  const logo = renderFluxPixelLogo(contentWidth, frame, { scale: logoScale });
  const actions = contentWidth >= 60
    ? [
      pairActions(starterActions[0], starterActions[1], contentWidth),
      pairActions(starterActions[2], starterActions[3], contentWidth),
    ]
    : starterActions.map((action) => renderStarterAction(action, contentWidth));
  const content = [
    ...logo,
    "",
    centerLine("Explore, build, and verify.", contentWidth),
    "",
    ...actions,
  ];
  const terminalRows = Number(process.stdout.rows) || 24;
  const conversationRows = Math.max(1, terminalRows - 8);
  const verticalInset = Math.min(8, Math.floor(Math.max(0, conversationRows - content.length) * 0.4));
  const lines = [
    ...Array.from({ length: verticalInset }, () => ""),
    ...content.map((line) => `${" ".repeat(inset)}${line}`),
  ];
  return lines.map((line) => truncateToWidth(line, safeWidth));
}

export function truncateMiddle(value: string, width: number): string {
  if (width <= 0) return "";
  if (visibleWidth(value) <= width) return value;
  if (width === 1) return "…";
  const available = width - 1;
  const leftWidth = Math.ceil(available * 0.58);
  const rightWidth = available - leftWidth;
  return `${takeLeft(value, leftWidth)}…${takeRight(value, rightWidth)}`;
}

export function renderConversationMessage(role: PresentationRole, content: string, width: number): string[] {
  const compact = width < 56;
  const contentWidth = Math.max(10, width - (compact ? 5 : 8));
  const label = role === "user" ? "YOU" : role === "assistant" ? "FLUX" : "NOTICE";
  const tone: FluxTone = role === "user" ? "user" : role === "assistant" ? "assistant" : "warning";
  const glyph = role === "user" ? fluxDesign.symbols.user : role === "assistant" ? fluxDesign.symbols.assistant : "!";
  const markdown = new Markdown(content || " ", 0, 0, createMarkdownTheme(tone));
  const body = markdown.render(contentWidth);
  const marker = fluxColor(fluxDesign.symbols.vertical, "border");
  return [
    ` ${fluxColor(glyph, tone)} ${fluxColor(label, tone)}`,
    ...body.map((line) => ` ${marker}  ${line}`),
    "",
  ];
}

export function renderConversationTimeline(
  messages: readonly { role: PresentationRole; content: string }[],
  tools: readonly ToolCardState[],
  width: number,
): string[] {
  const lines: string[] = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!;
    lines.push(...renderConversationMessage(message.role, message.content, width));
    lines.push(...renderToolCards(tools.filter((tool) => tool.messageIndex === index), width));
  }
  lines.push(...renderToolCards(
    tools.filter((tool) => tool.messageIndex === undefined || tool.messageIndex >= messages.length),
    width,
  ));
  return lines;
}

function takeRight(value: string, width: number): string {
  let suffix = "";
  for (const character of Array.from(value).reverse()) {
    const candidate = `${character}${suffix}`;
    if (visibleWidth(candidate) > width) break;
    suffix = candidate;
  }
  return suffix;
}

function takeLeft(value: string, width: number): string {
  let prefix = "";
  for (const character of Array.from(value)) {
    const candidate = `${prefix}${character}`;
    if (visibleWidth(candidate) > width) break;
    prefix = candidate;
  }
  return prefix;
}

function renderStarterAction(action: typeof starterActions[number], width: number): string {
  return truncateToWidth(
    `${fluxColor(`[${action.key}]`, "focus")}  ${fluxColor(action.label, "primary")}`,
    width,
  );
}

function pairActions(
  left: typeof starterActions[number],
  right: typeof starterActions[number],
  width: number,
): string {
  const gap = 3;
  const leftWidth = Math.floor((width - gap) / 2);
  const rightWidth = width - gap - leftWidth;
  return `${renderStarterAction(left, leftWidth)}${" ".repeat(gap)}${renderStarterAction(right, rightWidth)}`;
}

function centerLine(value: string, width: number): string {
  const clipped = truncateToWidth(value, width);
  return `${" ".repeat(Math.max(0, Math.floor((width - visibleWidth(clipped)) / 2)))}${clipped}`;
}

function createMarkdownTheme(bodyTone: FluxTone): MarkdownTheme {
  const body = (text: string) => fluxColor(text, bodyTone);
  return {
    heading: (text) => fluxColor(text, "brand"),
    link: body,
    linkUrl: (text) => fluxColor(text, "muted"),
    code: (text) => fluxColor(text, "warning"),
    codeBlock: (text) => fluxCodeBlock(text),
    codeBlockBorder: (text) => fluxColor(text, "border"),
    quote: body,
    quoteBorder: (text) => fluxColor(text, "muted"),
    hr: (text) => fluxColor(text, "border"),
    listBullet: (text) => fluxColor(text, "brand"),
    bold: (text) => fluxColor(text, "primary"),
    italic: body,
    strikethrough: (text) => fluxColor(text, "muted"),
    underline: body,
  };
}
