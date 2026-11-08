// Compact responsive renderer for FLUX's conversation-first terminal shell.

import { sanitizeUserFacingError, truncate, wrapText } from "./ansi.js"
import { defaultTheme, style, type UiTheme } from "./theme.js"
import type { ConversationMessage, ErrorNotice, ModelStatus, ProjectStatus, RenderOptions, TerminalSize, ToolCard, UiSnapshot } from "./types.js"

export class TerminalRenderer {
  readonly theme: UiTheme
  readonly options: Required<RenderOptions>

  constructor(options: RenderOptions = {}, theme = defaultTheme) {
    this.options = { color: options.color ?? true, compact: options.compact ?? false }
    this.theme = theme
  }

  render(snapshot: UiSnapshot, size: TerminalSize): string {
    const width = Math.max(24, size.width)
    const lines = [
      ...this.renderHeader(snapshot.project, snapshot.model, width),
      ...this.renderConversation(snapshot.messages, width),
      ...this.renderTools(snapshot.tools ?? [], width),
      ...this.renderErrorNotice(snapshot.error, width),
      ...this.renderFooter(snapshot.busy ?? false, width),
    ]
    const height = Math.max(1, size.height)
    return lines.slice(Math.max(0, lines.length - height)).map((line) => truncate(line, width)).join("\n")
  }

  private renderHeader(project: ProjectStatus | undefined, model: ModelStatus | undefined, width: number): string[] {
    const name = project?.name ?? "workspace"
    const path = project?.path ? ` ${truncate(project.path, Math.max(8, width - name.length - 18))}` : ""
    const branch = project?.branch ? `  ${project.branch}${project.dirty ? "*" : ""}` : ""
    const modelText = model ? `${model.provider}/${model.model}` : "model not configured"
    const connection = model?.connected === false ? "offline" : model ? "ready" : "waiting"
    const status = `${connection} · ${modelText}`
    const brand = style(" FLUX", this.theme.accent, this.options.color)
    if (width < 56) {
      return [
        `${brand}${style(` · ${truncate(name, Math.max(8, width - 12))}${branch}`, this.theme.warning, this.options.color)}`,
        style(` ${truncate(status, width - 2)}`, this.theme.muted, this.options.color),
        "",
      ]
    }
    return [
      `${brand}${style(` · ${name}`, this.theme.user, this.options.color)}${style(path, this.theme.muted, this.options.color)}${style(branch, this.theme.warning, this.options.color)}`,
      style(` ${truncate(status, width - 2)}`, this.theme.muted, this.options.color),
      "",
    ]
  }

  private renderConversation(messages: readonly ConversationMessage[], width: number): string[] {
    if (messages.length === 0) {
      return [
        style(" No messages yet. Ask FLUX to explore this workspace.", this.theme.muted, this.options.color),
        style(" Try: explain the architecture · review the current changes", this.theme.muted, this.options.color),
        "",
      ]
    }
    const compact = this.options.compact || width < 72
    return messages.flatMap((message) => {
      const label = message.role === "user" ? "› YOU" : message.role === "assistant" ? "◆ FLUX" : "! NOTICE"
      const color = message.role === "user" ? this.theme.user : message.role === "assistant" ? this.theme.assistant : this.theme.muted
      const prefix = `${label} `
      const contentWidth = Math.max(8, width - (compact ? prefix.length + 2 : prefix.length + 4))
      const body = wrapText(message.content, contentWidth)
      return [
        style(` ${prefix}${body[0] ?? ""}`, color, this.options.color),
        ...body.slice(1).map((line) => ` ${" ".repeat(prefix.length)}${line}`),
        ...(compact ? [] : ["" ]),
      ]
    })
  }

  private renderTools(tools: readonly ToolCard[], width: number): string[] {
    return tools.flatMap((tool) => {
      const icon = tool.status === "success" || tool.status === "done" ? "✓" : tool.status === "error" ? "×" : tool.status === "running" ? "…" : "·"
      const color = tool.status === "error" ? this.theme.error : tool.status === "success" || tool.status === "done" ? this.theme.success : this.theme.muted
      const title = `${icon} ${tool.name}`
      const detail = tool.detail ?? tool.input ?? tool.output
      const lines = detail ? wrapText(detail, Math.max(8, width - 8)).map((line) => `   ${line}`) : []
      return [style(` ${title}`, color, this.options.color), ...lines, ...(this.options.compact ? [] : [""])]
    })
  }

  private renderErrorNotice(error: ErrorNotice | undefined, width: number): string[] {
    if (!error) return []
    const lines = wrapText(sanitizeUserFacingError(error.message), Math.max(8, width - 4))
    return [
      style(` ! ${lines[0] ?? ""}`, this.theme.error, this.options.color),
      ...lines.slice(1).map((line) => style(`   ${line}`, this.theme.error, this.options.color)),
      ...(error.detail && width >= 64 ? [style(`   ${truncate(sanitizeUserFacingError(error.detail), width - 4)}`, this.theme.muted, this.options.color)] : []),
      "",
    ]
  }

  private renderFooter(busy: boolean, width: number): string[] {
    const hint = busy ? "working · esc to interrupt" : "enter send · ctrl+k commands · ? help"
    return [style(` ${truncate(hint, width - 2)}`, this.theme.muted, this.options.color), style(` ${"─".repeat(Math.max(1, width - 2))}`, this.theme.muted, this.options.color)]
  }
}

export function renderProjectStatus(project: ProjectStatus, width: number, options?: RenderOptions): string {
  return new TerminalRenderer(options).render({ project, messages: [] }, { width, height: 3 })
}

export function renderModelStatus(model: ModelStatus, width: number, options?: RenderOptions): string {
  return new TerminalRenderer(options).render({ model, messages: [] }, { width, height: 3 })
}

export function renderToolCard(tool: ToolCard, width: number, options?: RenderOptions): string {
  return new TerminalRenderer(options).render({ messages: [], tools: [tool] }, { width, height: 8 })
}

export function renderErrorNotice(error: ErrorNotice, width: number, options?: RenderOptions): string {
  return new TerminalRenderer(options).render({ messages: [], error }, { width, height: 8 })
}

