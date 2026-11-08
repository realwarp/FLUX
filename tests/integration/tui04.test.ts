import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderDiff } from "../../src/ui/diff-view.js";
import { renderFluxHeaderWordmark, renderFluxPixelLogo, shouldAnimateFluxLogo } from "../../src/ui/flux-logo.js";
import { InfoOverlay, SearchableSelect, SearchPrompt, type OverlayItem } from "../../src/ui/overlays.js";
import { renderConversationMessage, renderConversationTimeline, renderWelcomeScreen, truncateMiddle } from "../../src/ui/presentation.js";
import { FluxApprovalDialog, formatSidebarSessionLabel, shouldShowContextSidebar } from "../../src/ui/pi-app.js";
import { fluxColor, fluxSurface, shouldUseColor } from "../../src/ui/theme.js";
import { renderToolCard, type ToolCardState } from "../../src/ui/tool-cards.js";
import { TerminalRenderer } from "../../src/ui/renderer.js";
import { renderStatus, renderWelcome } from "../../src/ui/index.js";
import { sanitizeUserFacingError } from "../../src/ui/ansi.js";

describe("TUI-04 visual system", () => {
  test("uses FLUX semantic colors and honors no-color environments", () => {
    expect(shouldUseColor({})).toBe(true);
    expect(shouldUseColor({ NO_COLOR: "" })).toBe(false);
    expect(shouldUseColor({ TERM: "dumb" })).toBe(false);
    expect(shouldUseColor({ FORCE_COLOR: "0" })).toBe(false);
    expect(fluxColor("ready", "success", false)).toBe("ready");
    expect(fluxSurface("surface", false)).toBe("surface");
    expect(fluxSurface("surface", true)).toContain("\u001b[48;5;235m");
  });

  test("presents a welcome state and Markdown messages within narrow widths", () => {
    for (const width of [20, 36, 80]) {
      const welcome = renderWelcomeScreen(width);
      const message = renderConversationMessage("assistant", "# Summary\n\nUse `bun test`.\n\n```ts\nconst answer = 42;\n```", width);
      expect(welcome.join("\n")).toContain("F1");
      if (width >= 36) expect(welcome.join("\n")).toContain("Explain this project");
      expect(welcome.join("\n")).not.toContain("WORKSPACE");
      expect(welcome.join("\n")).not.toContain("MODEL");
      expect(message.join("\n")).toContain("Summary");
      expect(message.join("\n").replace(/\u001b\[[0-9;]*m/g, "").replace(/[^A-Za-z0-9_=;]/g, "")).toContain("constanswer=42;");
      for (const line of [...welcome, ...message]) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
    const detailed = new SearchableSelect("Command palette", [
      { value: "status", label: "Show status", category: "Workspace", description: "Show the current project, active model, session, and message count." },
    ], () => {}, () => {});
    expect(detailed.preferredWidth).toBe(80);
    expect(detailed.render(80).join("\n")).toContain("Workspace");
    expect(detailed.render(80).join("\n")).toContain("Show the current project");
    const originalRows = Object.getOwnPropertyDescriptor(process.stdout, "rows");
    Object.defineProperty(process.stdout, "rows", { configurable: true, value: 24 });
    try {
      const fullScreen = renderWelcomeScreen(140);
      const windowed = renderWelcomeScreen(80);
      const firstLogoLine = (lines: string[]) => lines.find((line) => line.includes("█"))?.replace(/\u001b\[[0-9;]*m/g, "") ?? "";
      expect(fullScreen.join("\n")).toContain("F1");
      expect(fullScreen.join("\n")).toContain("F4");
      expect(firstLogoLine(fullScreen).indexOf("█")).toBeGreaterThan(firstLogoLine(windowed).indexOf("█"));
      expect(fullScreen.join("\n")).not.toContain("C:\\Users\\Developer");
      expect(fullScreen.join("\n")).not.toContain("ollama/qwen");
    } finally {
      if (originalRows) Object.defineProperty(process.stdout, "rows", originalRows);
      else Reflect.deleteProperty(process.stdout, "rows");
    }
  });

  test("renders an original pixel wordmark with static ASCII and animated fallbacks", () => {
    const unicode = renderFluxPixelLogo(80, 0, { color: false, scale: 2 });
    const ascii = renderFluxPixelLogo(24, 1, { color: false, ascii: true });
    const header = renderFluxHeaderWordmark(0, { color: false });
    expect(unicode).toHaveLength(5);
    expect(unicode[0]).toContain("██████████");
    expect(visibleWidth(unicode[0]!.trimStart())).toBe(46);
    expect(unicode.join("\n")).toContain("█");
    expect(unicode.join("\n")).not.toContain("╱");
    expect(ascii.join("\n")).toContain("#");
    expect(ascii.join("\n")).not.toContain("█");
    expect(ascii.join("\n")).not.toContain("CODING AGENT");
    expect(header).toHaveLength(3);
    expect(header.join("\n")).toContain("█");
    expect(renderFluxHeaderWordmark(0, { color: true })).not.toEqual(renderFluxHeaderWordmark(1, { color: true }));
    expect(renderFluxPixelLogo(80, 0, { color: true, scale: 2 })).not.toEqual(renderFluxPixelLogo(80, 1, { color: true, scale: 2 }));
    for (const line of unicode) expect(visibleWidth(line)).toBeLessThanOrEqual(80);
    for (const line of ascii) expect(visibleWidth(line)).toBeLessThanOrEqual(24);
    expect(shouldShowContextSidebar(131)).toBe(false);
    expect(shouldShowContextSidebar(132)).toBe(true);
    expect(truncateMiddle("C:\\Users\\Developer\\Projects\\FLUX", 18)).toContain("…");
    expect(truncateMiddle("C:\\Users\\Developer\\Projects\\FLUX", 18).endsWith("FLUX")).toBe(true);
    expect(formatSidebarSessionLabel("Feature work", "old prompt")).toBe("Feature work");
    expect(formatSidebarSessionLabel(undefined, "Implement the settings page")).toBe("Implement the settings page");
    expect(formatSidebarSessionLabel(undefined, undefined)).toBe("New session");
    expect(sanitizeUserFacingError("Failed at C:\\Users\\Developer\\FLUX\\node_modules\\runtime\\index.js"))
      .toBe("Failed at [internal dependency path]");
    expect(sanitizeUserFacingError("Failed at C:\\Users\\Developer\\.pi\\agent\\sessions\\broken.jsonl"))
      .toBe("Failed at [internal session path]");
    expect(sanitizeUserFacingError("Pi SDK failed in @earendil-works/pi-coding-agent"))
      .toBe("FLUX runtime failed in FLUX runtime");
  });

  test("only animates the logo in supported color TTY environments", () => {
    expect(shouldAnimateFluxLogo(true, {})).toBe(true);
    expect(shouldAnimateFluxLogo(false, {})).toBe(false);
    expect(shouldAnimateFluxLogo(true, { NO_COLOR: "" })).toBe(false);
    expect(shouldAnimateFluxLogo(true, { TERM: "dumb" })).toBe(false);
    expect(shouldAnimateFluxLogo(true, { FLUX_DISABLE_ANIMATION: "1" })).toBe(false);
  });

  test("shows a bounded approval operation preview and preserves Y/N/Esc decisions", () => {
    const request = {
      operation: "write" as const,
      description: "Create a configuration file",
      path: "C:\\workspace\\FLUX\\settings.json",
      preview: '{\n  "enabled": true\n}',
    };
    const decisions: boolean[] = [];
    const dialog = new FluxApprovalDialog(request, "C:\\workspace\\FLUX", (approved) => decisions.push(approved));
    dialog.render(12);
    dialog.handleInput("y");
    expect(decisions).toEqual([]);
    const lines = dialog.render(48);
    expect(lines.join("\n")).toContain("PERMISSION REQUIRED");
    expect(lines.join("\n")).toContain("settings.json");
    expect(lines.join("\n")).toContain("OPERATION PREVIEW");
    expect(lines.join("\n")).toContain("+ {");
    for (const width of [4, 12, 18, 48]) {
      for (const line of dialog.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }

    dialog.handleInput("\u001b[A");
    dialog.handleInput("\r");
    dialog.handleInput("n");
    dialog.handleInput("\u001b");
    expect(decisions).toEqual([true, false, false]);

    const originalRows = Object.getOwnPropertyDescriptor(process.stdout, "rows");
    try {
      for (const rows of [4, 5, 6, 7, 8, 9, 24]) {
        Object.defineProperty(process.stdout, "rows", { configurable: true, value: rows });
        for (const width of [12, 48]) {
          const rendered = dialog.render(width);
          expect(rendered.length).toBeLessThanOrEqual(rows);
          for (const line of rendered) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
        }
      }
      Object.defineProperty(process.stdout, "rows", { configurable: true, value: 4 });
      dialog.handleInput("y");
      expect(decisions).toEqual([true, false, false]);
      dialog.handleInput("\u001b");
      expect(decisions).toEqual([true, false, false, false]);

      const compactDecisions: boolean[] = [];
      const compactDialog = new FluxApprovalDialog(request, "C:\\workspace\\FLUX", (approved) => compactDecisions.push(approved));
      Object.defineProperty(process.stdout, "rows", { configurable: true, value: 8 });
      compactDialog.render(48);
      compactDialog.handleInput("y");
      expect(compactDecisions).toEqual([]);
      Object.defineProperty(process.stdout, "rows", { configurable: true, value: 9 });
      compactDialog.render(48);
      compactDialog.handleInput("y");
      expect(compactDecisions).toEqual([true]);
    } finally {
      if (originalRows) Object.defineProperty(process.stdout, "rows", originalRows);
      else Reflect.deleteProperty(process.stdout, "rows");
    }
  });

  test("resizes search and context overlays without exceeding terminal width", () => {
    const items: OverlayItem[] = [
      { label: "Show status", description: "Current workspace and model", value: "status" },
      { label: "Search files", description: "Find text in workspace", value: "search" },
    ];
    const select = new SearchableSelect("Commands", items, () => {}, () => {});
    const info = new InfoOverlay("Context", ["Workspace: FLUX", "Model: ollama/qwen", "Long detail ".repeat(12)], () => {});
    for (const width of [1, 2, 3, 4, 18, 30, 80]) {
      for (const line of [...select.render(width), ...info.render(width)]) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  test("fits selector and search overlays within short terminal heights", () => {
    const originalRows = Object.getOwnPropertyDescriptor(process.stdout, "rows");
    try {
      for (const rows of [2, 3, 4, 5, 6, 10, 12]) {
        Object.defineProperty(process.stdout, "rows", { configurable: true, value: rows });
        const select = new SearchableSelect("Commands", [
          { value: "status", label: "Show status", category: "Workspace", description: "Show project and model" },
          { value: "model", label: "Select model", category: "Models", description: "Choose an active model" },
        ], () => undefined, () => undefined);
        const prompt = new SearchPrompt(() => undefined, () => undefined);
        for (const component of [select, prompt]) {
          const lines = component.render(24);
          expect(lines.length).toBeLessThanOrEqual(rows);
          for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(24);
        }
      }
    } finally {
      if (originalRows) Object.defineProperty(process.stdout, "rows", originalRows);
      else Reflect.deleteProperty(process.stdout, "rows");
    }
  });

  test("limits context overlays to short terminal heights and scrolls their content", () => {
    const originalRows = Object.getOwnPropertyDescriptor(process.stdout, "rows");
    Object.defineProperty(process.stdout, "rows", { configurable: true, value: 6 });
    try {
      const info = new InfoOverlay("Context", Array.from({ length: 20 }, (_, index) => `Entry ${index}`), () => {});
      const initial = info.render(30);
      info.handleInput("\x1b[B");
      const scrolled = info.render(30);
      expect(initial).toHaveLength(6);
      expect(scrolled).toHaveLength(6);
      expect(scrolled).not.toEqual(initial);
    } finally {
      if (originalRows) Object.defineProperty(process.stdout, "rows", originalRows);
      else Reflect.deleteProperty(process.stdout, "rows");
    }
  });

  test("keeps tool and diff output bounded at narrow widths", () => {
    const card: ToolCardState = {
      id: "tool",
      name: "shell",
      status: "running",
      description: "Run a long command",
      command: "bun test ".repeat(10),
      expanded: false,
    };
    for (const width of [20, 40]) {
      for (const line of [...renderToolCard(card, width), ...renderDiff({ text: `+${"changed ".repeat(12)}`, truncated: false }, width)]) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  test("keeps tool results adjacent to the conversation turn that invoked them", () => {
    const timeline = renderConversationTimeline(
      [
        { role: "user", content: "Read this file." },
        { role: "assistant", content: "The file contains a setting." },
      ],
      [{
        id: "read-1",
        name: "read",
        status: "success",
        description: "Read workspace file",
        messageIndex: 0,
        output: "enabled=true",
        expanded: true,
      }],
      80,
    ).join("\n");
    expect(timeline.indexOf("YOU")).toBeLessThan(timeline.indexOf("READ"));
    expect(timeline.indexOf("READ")).toBeLessThan(timeline.indexOf("FLUX"));
  });

  test("keeps non-TTY rendering branded and responsive", () => {
    const output = new TerminalRenderer({ color: false }).render({
      project: { name: "FLUX", path: "C:\\workspace\\FLUX" },
      messages: [{ role: "assistant", content: "The workspace is ready." }],
    }, { width: 40, height: 8 });
    const welcome = renderWelcome({ cwd: "C:\\workspace\\FLUX", model: "ollama/qwen", sessionId: "session" });
    const status = renderStatus({
      cwd: "C:\\workspace\\FLUX",
      model: "ollama/qwen",
      sessionId: "01234567-89ab-cdef-0123-456789abcdef",
      sessionPersisted: true,
    });
    expect(output).toContain("FLUX");
    expect(welcome).toContain("#");
    expect(welcome).toContain("Explore, change, and verify");
    expect(welcome).toContain("session    session");
    expect(status).toContain("session  01234567");
    expect(status).toContain("persistence  saved");
    expect(status).not.toContain(".pi");
    expect(status).not.toContain("01234567-89ab-cdef-0123-456789abcdef");
    for (const line of output.split("\n")) expect(visibleWidth(line)).toBeLessThanOrEqual(40);
  });
});
