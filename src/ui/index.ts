// Public terminal UI surface for FLUX integrations.

import { renderFluxPixelLogo } from "./flux-logo.js"
import { sanitizeUserFacingError } from "./ansi.js";

export { applyInputKey, createInputState, renderComposer } from "./input.js"
export {
  renderErrorNotice,
  renderModelStatus,
  renderProjectStatus,
  renderToolCard,
  TerminalRenderer,
} from "./renderer.js"
export { defaultTheme, style } from "./theme.js"
export { FluxPiApp, type FluxPiAppOptions } from "./pi-app.js"
export type { UiTheme } from "./theme.js"
import type { ToolStatus } from "./types.js"
export type {
  ConversationMessage,
  ErrorNotice,
  InputKey,
  InputState,
  ModelStatus,
  ProjectStatus,
  RenderOptions,
  TerminalSize,
  ToolCard,
  ToolStatus,
  UiRole,
  UiSnapshot,
} from "./types.js"

export interface WelcomeOptions {
  cwd: string
  model: string
  sessionId: string
}

export interface ToolEvent {
  name: string
  status: ToolStatus
  detail?: string
}

export interface StatusOptions {
  cwd: string
  model: string
  sessionId: string
  sessionPersisted: boolean
}

export function renderWelcome(options: WelcomeOptions): string {
  return [
    ...renderFluxPixelLogo(31, 0, { color: false, ascii: true }),
    `workspace  ${options.cwd}`,
    `model      ${options.model}`,
    `session    ${shortSessionId(options.sessionId)}`,
    "",
    "Explore, change, and verify this workspace.",
    "Try: explain this project · find a bug · review recent changes",
    "Type ? for help.",
  ].join("\n")
}

export function renderUserMessage(text: string): string {
  return `you ${text}`
}

export function renderAssistantDelta(delta: string): string {
  return delta
}

export function renderToolEvent(event: ToolEvent): string {
  const icon = event.status === "success" || event.status === "done" ? "✓" : event.status === "error" ? "×" : event.status === "running" ? "…" : "·"
  return `${icon} ${event.name}${event.detail ? ` — ${event.detail}` : ""}`
}

export function renderError(message: string): string {
  return `! ${sanitizeUserFacingError(message)}`;
}

export function renderHelp(): string {
  return [
    "FLUX — Terminal-native AI Coding Agent",
    "Usage: flux [setup] [--cwd=PATH] [--resume] [--prompt=TEXT] [--approve]",
    "  setup           configure a provider or model",
    "  --help, -h      show this help",
    "  --version, -v   show the FLUX version",
    "  --cwd=PATH      use a specific workspace",
    "  --resume        continue the most recent workspace session",
    "  --prompt=TEXT   send one prompt and exit",
    "  --approve       automatically approve writes, patches, and shell commands",
    "",
    "Interactive commands",
    "  enter       send message",
    "  esc         interrupt or close",
    "  up/down     prompt history",
    "  /status     session and model status",
    "  /models     list configured models",
    "  /model p/m  switch provider/model",
    "  /diff       show the current git diff",
    "  ?           show help",
  ].join("\n")
}

export function renderStatus(options: StatusOptions): string {
  return [
    `project  ${options.cwd}`,
    `model    ${options.model}`,
    `session  ${shortSessionId(options.sessionId)}`,
    `persistence  ${options.sessionPersisted ? "saved" : "pending"}`,
  ].join("\n")
}

function shortSessionId(sessionId: string): string {
  return sessionId.replace(/-/g, "").slice(0, 8)
}

