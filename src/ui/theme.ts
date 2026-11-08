// FLUX's semantic palette and terminal-safe spacing scale.

export type FluxTone =
  | "brand"
  | "primary"
  | "secondary"
  | "user"
  | "assistant"
  | "muted"
  | "border"
  | "focus"
  | "selection"
  | "success"
  | "warning"
  | "error"
  | "code";

export const fluxDesign = {
  colors: {
    brand: 141,
    primary: 255,
    secondary: 189,
    user: 117,
    assistant: 183,
    muted: 245,
    border: 60,
    focus: 177,
    selection: 99,
    success: 114,
    warning: 221,
    error: 203,
    code: 189,
  } satisfies Record<FluxTone, number>,
  accents: {
    violet: 141,
    purple: 135,
    magenta: 201,
    cyan: 51,
    background: 235,
  },
  spacing: {
    page: 1,
    message: 2,
    indent: 2,
    compactIndent: 1,
  },
  symbols: {
    assistant: "◆",
    user: "›",
    divider: "─",
    vertical: "│",
  },
} as const;

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
  accent: ansiForeground(fluxDesign.colors.brand),
  muted: ansiForeground(fluxDesign.colors.muted),
  user: ansiForeground(fluxDesign.colors.user),
  assistant: ansiForeground(fluxDesign.colors.assistant),
  success: ansiForeground(fluxDesign.colors.success),
  warning: ansiForeground(fluxDesign.colors.warning),
  error: ansiForeground(fluxDesign.colors.error),
  reset: "\u001b[0m",
}

export function shouldUseColor(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.FORCE_COLOR !== "0" &&
    environment.NO_COLOR === undefined &&
    environment.TERM !== "dumb"
}

export function fluxColor(value: string, tone: FluxTone, enabled = shouldUseColor()): string {
  if (!enabled) return value;
  return `${ansiForeground(fluxDesign.colors[tone])}${value}\u001b[0m`;
}

export function fluxSurface(value: string, enabled = shouldUseColor()): string {
  if (!enabled) return value;
  const background = `\u001b[48;5;${fluxDesign.accents.background}m`;
  return `${background}${value.replace(/\u001b\[0m/g, `\u001b[0m${background}`)}\u001b[0m`;
}

export function fluxCodeBlock(value: string, enabled = shouldUseColor()): string {
  if (!enabled) return value;
  return `\u001b[48;5;235m\u001b[38;5;${fluxDesign.colors.code}m${value}\u001b[0m`;
}

export function style(value: string, color: string, enabled: boolean, theme = defaultTheme): string {
  return enabled && shouldUseColor() ? `${color}${value}${theme.reset}` : value
}

function ansiForeground(color: number): string {
  return `\u001b[38;5;${color}m`;
}
