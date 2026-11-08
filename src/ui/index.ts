// Public terminal UI surface for FLUX integrations.

export { applyInputKey, createInputState, renderComposer } from "./input.js"
export {
  renderErrorNotice,
  renderModelStatus,
  renderProjectStatus,
  renderToolCard,
  TerminalRenderer,
} from "./renderer.js"
export { defaultTheme, style } from "./theme.js"
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
  sessionFile?: string
}

export function renderWelcome(options: WelcomeOptions): string {
  return [
    "FLUX",
    `project  ${options.cwd}`,
    `model    ${options.model}`,
    `session  ${options.sessionId}`,
    "",
    "Ask about the project, or type ? for help.",
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
  return `! ${message}`
}

export function renderHelp(): string {
  return [
    "FLUX commands",
    "  enter       send message",
    "  ctrl+k      command palette",
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
    `session  ${options.sessionId}`,
    ...(options.sessionFile ? [`file     ${options.sessionFile}`] : []),
  ].join("\n")
}

