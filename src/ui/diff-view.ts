import { truncateToWidth } from "@earendil-works/pi-tui";
import { fluxColor } from "./theme.js";

export interface DiffSnapshot {
  text: string;
  truncated: boolean;
}

const MAX_DIFF = 32_000;

export function createDiffSnapshot(text: string): DiffSnapshot {
  if (text.length <= MAX_DIFF) return { text, truncated: false };
  return { text: `${text.slice(0, MAX_DIFF)}\n\n[diff truncated at ${MAX_DIFF} bytes]`, truncated: true };
}

export function renderDiff(snapshot: DiffSnapshot, width: number): string[] {
  if (!snapshot.text.trim()) return [` ${fluxColor("✓ No workspace diff.", "muted")}`];
  return [
    ` ${fluxColor("╭─ WORKSPACE DIFF", "brand")}`,
    ...snapshot.text.split(/\r?\n/).map((line) => {
      const clipped = truncateToWidth(line, Math.max(8, width - 2));
      if (clipped.startsWith("+++ ") || clipped.startsWith("--- ")) return ` ${fluxColor(clipped, "warning")}`;
      if (clipped.startsWith("+")) return ` ${fluxColor(clipped, "success")}`;
      if (clipped.startsWith("-")) return ` ${fluxColor(clipped, "error")}`;
      if (clipped.startsWith("@@")) return ` ${fluxColor(clipped, "brand")}`;
      return ` ${clipped}`;
    }),
  ];
}
