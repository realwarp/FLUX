// Pi-aware terminal width helpers for ANSI styling and Unicode text.

import { truncateToWidth, visibleWidth as piVisibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export function visibleWidth(value: string): number {
  return piVisibleWidth(value);
}

export function truncate(value: string, width: number): string {
  if (width <= 0) return "";
  return truncateToWidth(value, width, width === 1 ? "…" : "…");
}

export function wrapText(value: string, width: number): string[] {
  if (width <= 0) return [""];
  return value.split(/\r?\n/).flatMap((line) => line ? wrapTextWithAnsi(line, width) : [""]);
}

export function pad(value: string, width: number): string {
  return `${value}${" ".repeat(Math.max(0, width - visibleWidth(value)))}`;
}

export function sanitizeUserFacingError(value: string): string {
  return value
    .replace(
      /(?:[A-Za-z]:[\\/]|\/)[^\r\n"'`()]*?node_modules[\\/][^\r\n"'`()\s]*/gi,
      "[internal dependency path]",
    )
    .replace(
      /(?:[A-Za-z]:[\\/]|\/)[^\r\n"'`()]*?\.pi[\\/]agent[\\/][^\r\n"'`()\s]*/gi,
      "[internal session path]",
    )
    .replace(/@earendil-works\/pi-[\w-]+/gi, "FLUX runtime")
    .replace(/\bPi (?:Coding Agent|SDK|runtime)\b/gi, "FLUX runtime");
}
