import { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import { filterSearchable, type SearchableItem } from "./navigation.js";
import { fluxColor, fluxDesign, fluxSurface, shouldUseColor } from "./theme.js";

export interface OverlayItem extends SearchableItem {
  value: string;
  category?: string;
  shortcut?: string;
  disabled?: boolean;
}

export class SearchableSelect implements Component {
  capturesViewportInput = true;
  private query = "";
  private filteredItems: readonly OverlayItem[];
  private selectedIndex = 0;
  private offset = 0;

  constructor(
    private readonly title: string,
    private readonly items: readonly OverlayItem[],
    private readonly onSelect: (item: OverlayItem) => void,
    private readonly onCancel: () => void,
  ) {
    this.filteredItems = items;
    this.selectedIndex = Math.max(0, items.findIndex((item) => !item.disabled));
  }

  get preferredWidth(): number {
    const descriptionWidth = Math.min(54, Math.max(0, ...this.items.map((item) => visibleWidth(item.description ?? ""))));
    const textWidth = Math.max(
      visibleWidth(this.title),
      ...this.items.map((item) => visibleWidth(`${item.label} ${item.category ?? ""} ${item.shortcut ?? ""}`)),
    );
    return Math.max(42, Math.min(80, Math.max(textWidth + 18, descriptionWidth + 30)));
  }

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(1, width);
    const innerWidth = Math.max(1, safeWidth - 4);
    const terminalRows = Number(process.stdout.rows) || 24;
    const ultraCompact = terminalRows < 4;
    const compact = terminalRows < 12;
    const visibleRows = visibleSelectRows(terminalRows);
    this.offset = Math.max(0, Math.min(this.offset, this.filteredItems.length - visibleRows));
    if (this.selectedIndex < this.offset) this.offset = this.selectedIndex;
    if (this.selectedIndex >= this.offset + visibleRows) this.offset = this.selectedIndex - visibleRows + 1;
    const visibleItems = this.filteredItems.slice(this.offset, this.offset + visibleRows);
    const rows = visibleItems.flatMap((item, index) => {
      const itemIndex = this.offset + index;
      const selected = itemIndex === this.selectedIndex;
      if (ultraCompact) {
        const label = `${selected ? "› " : "  "}${item.category ? `${item.category} · ` : ""}${item.label} ${item.shortcut ?? ""}`;
        return [frameLine(selected ? selectionLine(label, innerWidth) : fluxColor(label, item.disabled ? "muted" : "primary"), safeWidth)];
      }
      if (compact) {
        const label = `${selected ? "› " : "  "}${item.category ? `${item.category} · ` : ""}${item.label} — ${item.description ?? ""}`;
        return [frameLine(selected ? selectionLine(label, innerWidth) : fluxColor(label, item.disabled ? "muted" : "primary"), safeWidth)];
      }
      const titlePrefix = selected ? "› " : "  ";
      const shortcut = item.shortcut ?? "";
      const labelWidth = Math.max(1, innerWidth - visibleWidth(titlePrefix) - visibleWidth(shortcut) - (shortcut ? 1 : 0));
      const label = truncateToWidth(item.label, labelWidth);
      const gap = shortcut ? " ".repeat(Math.max(1, innerWidth - visibleWidth(titlePrefix + label) - visibleWidth(shortcut))) : "";
      const titleLine = `${titlePrefix}${label}${gap}${shortcut}`;
      const description = item.description ?? "";
      const categoryWidth = item.category
        ? Math.min(20, Math.max(10, Math.floor(innerWidth * 0.3)))
        : 0;
      const secondaryLine = item.category
        ? `${truncateToWidth(item.category, categoryWidth).padEnd(categoryWidth)}  ${truncateToWidth(description, Math.max(1, innerWidth - categoryWidth - 2))}`
        : truncateToWidth(description, innerWidth) || " ";
      return [
        frameLine(selected ? selectionLine(titleLine, innerWidth) : fluxColor(titleLine, item.disabled ? "muted" : "primary"), safeWidth),
        frameLine(fluxColor(truncateToWidth(secondaryLine, innerWidth), "muted"), safeWidth),
      ];
    });
    if (this.filteredItems.length === 0) rows.push(frameLine(fluxColor("No results", "error"), safeWidth));
    const range = this.filteredItems.length > visibleRows
      ? `${this.offset + 1}-${Math.min(this.offset + visibleRows, this.filteredItems.length)}/${this.filteredItems.length}`
      : "";
    const lines = [
      frameTop(this.title, safeWidth),
      ...(ultraCompact ? [] : [frameLine(`${fluxColor("⌕", "brand")} ${fluxColor(this.query || "Type to filter", this.query ? "primary" : "muted")}`, safeWidth)]),
      ...rows,
      ...(!ultraCompact && terminalRows >= 5
        ? [frameLine(fluxColor(safeWidth < 28 || compact ? "↑↓ Enter Esc" : `↑↓ move · Enter select · Esc close${range ? ` · ${range}` : ""}`, "muted"), safeWidth)]
        : []),
      frameBottom(safeWidth),
    ];
    return lines.slice(0, terminalRows);
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.onCancel();
      return;
    }
    if (matchesKey(data, "backspace")) {
      this.query = this.query.slice(0, -1);
      this.filter();
      return;
    }
    if (matchesKey(data, "up")) {
      this.move(-1);
      return;
    }
    if (matchesKey(data, "down")) {
      this.move(1);
      return;
    }
    if (matchesKey(data, "pageUp")) {
      this.move(-visibleSelectRows(Number(process.stdout.rows) || 24));
      return;
    }
    if (matchesKey(data, "pageDown")) {
      this.move(visibleSelectRows(Number(process.stdout.rows) || 24));
      return;
    }
    if (matchesKey(data, "enter")) {
      const selected = this.filteredItems[this.selectedIndex];
      if (selected && !selected.disabled) this.onSelect(selected);
      return;
    }
    if (/^[\p{L}\p{N} ._/@:+-]+$/u.test(data)) {
      this.query += data;
      this.filter();
    }
  }

  private filter(): void {
    this.filteredItems = filterSearchable(this.items, this.query);
    this.selectedIndex = this.filteredItems.findIndex((item) => !item.disabled);
    if (this.selectedIndex < 0) this.selectedIndex = 0;
    this.offset = 0;
  }

  private move(delta: number): void {
    if (this.filteredItems.length === 0) return;
    const direction = Math.sign(delta);
    for (let step = 0; step < Math.abs(delta); step++) {
      let candidate = this.selectedIndex;
      for (let attempt = 0; attempt < this.filteredItems.length; attempt++) {
        candidate = (candidate + direction + this.filteredItems.length) % this.filteredItems.length;
        if (!this.filteredItems[candidate]?.disabled) break;
      }
      if (!this.filteredItems[candidate]?.disabled) this.selectedIndex = candidate;
    }
  }
}

export class SearchPrompt implements Component {
  capturesViewportInput = true;
  private query = "";

  constructor(
    private readonly onSubmit: (query: string) => void,
    private readonly onCancel: () => void,
  ) {}

  get preferredWidth(): number {
    return 56;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(1, width);
    const terminalRows = Number(process.stdout.rows) || 24;
    const compact = terminalRows < 5;
    return [
      frameTop("Search workspace files", safeWidth),
      ...(!compact ? [frameLine(fluxColor(safeWidth < 28 ? "Enter searches · Esc closes" : "Type a text query · Enter searches · Esc closes", "muted"), safeWidth)] : []),
      frameLine(`${fluxColor("›", "focus")} ${truncateToWidth(this.query || "Type to search", Math.max(8, safeWidth - 6))}`, safeWidth),
      frameBottom(safeWidth),
    ].slice(0, terminalRows);
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.onCancel();
      return;
    }
    if (matchesKey(data, "enter")) {
      const query = this.query.trim();
      if (query) this.onSubmit(query);
      return;
    }
    if (matchesKey(data, "backspace")) {
      this.query = this.query.slice(0, -1);
      return;
    }
    if (/^[\p{L}\p{N} ._/@:+-]+$/u.test(data)) this.query += data;
  }
}

export class InfoOverlay implements Component {
  capturesViewportInput = true;
  private offset = 0;

  constructor(
    private readonly title: string,
    private readonly lines: readonly string[],
    private readonly onClose: () => void,
  ) {}

  get preferredWidth(): number {
    const textWidth = Math.max(0, ...this.lines.map((line) => visibleWidth(line)));
    return Math.max(48, Math.min(80, textWidth + 6));
  }

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(1, width);
    const innerWidth = Math.max(1, safeWidth - 4);
    const visualLines = this.lines.flatMap((line) => line ? wrapTextWithAnsi(line, innerWidth) : [""]);
    const terminalRows = Number(process.stdout.rows) || 24;
    const showHint = terminalRows >= 5;
    const visibleLimit = Math.max(0, Math.min(12, terminalRows - 2 - (showHint ? 1 : 0)));
    this.offset = Math.min(this.offset, Math.max(0, visualLines.length - visibleLimit));
    const visible = visualLines.slice(this.offset, this.offset + visibleLimit);
    const hint = visualLines.length > visibleLimit ? "↑/↓ scroll · Esc close" : "Enter or Esc to close";
    return [
      frameTop(this.title, safeWidth),
      ...visible.map((line) => frameLine(truncateToWidth(line, innerWidth), safeWidth)),
      ...(showHint ? [frameLine(fluxColor(hint, "muted"), safeWidth)] : []),
      frameBottom(safeWidth),
    ].slice(0, terminalRows);
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "enter") || matchesKey(data, "ctrl+c")) {
      this.onClose();
      return;
    }
    if (matchesKey(data, "up")) this.offset = Math.max(0, this.offset - 1);
    if (matchesKey(data, "down")) this.offset++;
    if (matchesKey(data, "pageUp")) this.offset = Math.max(0, this.offset - 12);
    if (matchesKey(data, "pageDown")) this.offset += 12;
  }
}

function frameTop(title: string, width: number): string {
  if (width < 6) return truncateToWidth(title, width);
  const label = truncateToWidth(` ${title} `, Math.max(1, width - 5));
  const prefix = `${fluxColor("╭─", "border")}${fluxColor("╱", "brand")}${fluxColor(label, "primary")}`;
  const fill = Math.max(0, width - visibleWidth(prefix) - 1);
  return `${prefix}${fluxColor("─".repeat(fill), "border")}${fluxColor("╮", "border")}`;
}

function frameLine(content: string, width: number): string {
  if (width < 4) return truncateToWidth(content, width);
  const innerWidth = Math.max(0, width - 4);
  return fluxSurface(`${fluxColor("│", "border")} ${truncateToWidth(content, innerWidth)} ${fluxColor("│", "border")}`);
}

function frameBottom(width: number): string {
  if (width < 2) return truncateToWidth("╰╯", width);
  return fluxColor(`╰${"─".repeat(Math.max(0, width - 2))}╯`, "border");
}

function selectionLine(value: string, width: number): string {
  const padded = `${value}${" ".repeat(Math.max(0, width - visibleWidth(value)))}`;
  if (!shouldUseColor()) return padded;
  return `\u001b[48;5;${fluxDesign.colors.selection}m\u001b[38;5;255m${padded}\u001b[0m`;
}

function visibleSelectRows(rows: number): number {
  if (rows < 4) return Math.max(0, rows - 2);
  if (rows === 4) return 1;
  if (rows < 12) return rows - 4;
  return Math.max(1, Math.min(6, Math.floor((rows * 0.72 - 6) / 2)));
}
