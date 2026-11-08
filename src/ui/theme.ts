// Semantic terminal styling used by the renderer.

export interface UiTheme {
  accent: string
  muted: string
  user: string
  assistant: string
  success: string
  warning: string
  error: string
  reset: string
}

export const defaultTheme: UiTheme = {
  accent: "\u001b[38;5;81m",
  muted: "\u001b[38;5;245m",
  user: "\u001b[38;5;117m",
  assistant: "\u001b[38;5;114m",
  success: "\u001b[38;5;114m",
  warning: "\u001b[38;5;221m",
  error: "\u001b[38;5;203m",
  reset: "\u001b[0m",
}

export function style(value: string, color: string, enabled: boolean, theme = defaultTheme): string {
  return enabled ? `${color}${value}${theme.reset}` : value
}

