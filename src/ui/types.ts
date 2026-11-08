// Public data contracts for FLUX's terminal presentation layer.

export type UiRole = "user" | "assistant" | "system"
export type ToolStatus = "running" | "success" | "done" | "error" | "pending"

export interface ProjectStatus {
  name: string
  path: string
  branch?: string
  dirty?: boolean
}

export interface ModelStatus {
  provider: string
  model: string
  contextUsed?: number
  contextLimit?: number
  connected?: boolean
}

export interface ConversationMessage {
  role: UiRole
  content: string
  timestamp?: string
}

export interface ToolCard {
  name: string
  input?: string
  output?: string
  status: ToolStatus
  detail?: string
}

export interface ErrorNotice {
  message: string
  detail?: string
  recoverable?: boolean
}

export interface UiSnapshot {
  project?: ProjectStatus
  model?: ModelStatus
  messages: readonly ConversationMessage[]
  tools?: readonly ToolCard[]
  error?: ErrorNotice
  busy?: boolean
}

export interface TerminalSize {
  width: number
  height: number
}

export interface RenderOptions {
  color?: boolean
  compact?: boolean
}

export interface InputState {
  value: string
  cursor: number
  history: readonly string[]
  historyIndex: number
}

export type InputKey =
  | { type: "character"; value: string }
  | { type: "backspace" }
  | { type: "delete" }
  | { type: "left" }
  | { type: "right" }
  | { type: "home" }
  | { type: "end" }
  | { type: "up" }
  | { type: "down" }
  | { type: "enter" }
  | { type: "escape" }

