import { describe, expect, test } from "bun:test";
import { ApprovalBroker } from "../../src/tools/pi-tools.js";
import { createDiffSnapshot, renderDiff } from "../../src/ui/diff-view.js";
import { renderToolCard, summarizeToolResult, toggleToolCard, type ToolCardState } from "../../src/ui/tool-cards.js";
import { FLUX_LAYOUT_CONSTRAINTS } from "../../src/ui/pi-app.js";

function card(status: ToolCardState["status"]): ToolCardState {
  return {
    id: status,
    name: "write",
    status,
    description: "Write workspace file",
    target: "src/example.ts",
    output: "updated content",
    durationMs: 42,
    expanded: false,
  };
}

describe("TUI-02 tool experience", () => {
  test("keeps transcript flexible while composer and footer stay pinned", () => {
    expect(FLUX_LAYOUT_CONSTRAINTS.header.shrink).toBe(0);
    expect(FLUX_LAYOUT_CONSTRAINTS.transcript.grow).toBe(1);
    expect(FLUX_LAYOUT_CONSTRAINTS.transcript.minSize).toBe(1);
    expect(FLUX_LAYOUT_CONSTRAINTS.composer.shrink).toBe(0);
    expect(FLUX_LAYOUT_CONSTRAINTS.footer.shrink).toBe(0);
  });

  test("renders every tool lifecycle state and expands details", () => {
    for (const status of ["pending", "running", "updating", "success", "failed", "denied", "cancelled"] as const) {
      const lines = renderToolCard(card(status), 80).join("\n");
      expect(lines).toContain(status.toUpperCase());
      expect(lines).toContain("src/example.ts");
    }

    const expanded = card("success");
    toggleToolCard(expanded);
    expect(renderToolCard(expanded, 80).join("\n")).toContain("Ctrl+O collapse");
  });

  test("bounds tool output and redacts secret-like values", () => {
    const summary = summarizeToolResult({
      content: [{ type: "text", text: `token=secret-value ${"x".repeat(2_000)}` }],
    });
    expect(summary.output).toContain("token=[redacted]");
    expect(summary.output).toContain("[truncated]");
    expect(summary.output?.length).toBeLessThanOrEqual(820);
  });

  test("renders bounded colored diffs and an explicit empty state", () => {
    const snapshot = createDiffSnapshot("--- a/example.ts\n+++ b/example.ts\n@@\n-old\n+new");
    const lines = renderDiff(snapshot, 80).join("\n");
    expect(lines).toContain("DIFF");
    expect(lines).toContain("old");
    expect(lines).toContain("new");
    expect(renderDiff(createDiffSnapshot(""), 80).join("\n")).toContain("No workspace diff.");

    const truncated = createDiffSnapshot("x".repeat(40_000));
    expect(truncated.truncated).toBe(true);
    expect(truncated.text).toContain("diff truncated");
  });

  test("approval broker requires a handler unless launch approval is explicit", async () => {
    const denied = new ApprovalBroker();
    expect(await denied.request({ operation: "write", description: "write file" })).toBe(false);

    const requests: string[] = [];
    const interactive = new ApprovalBroker();
    interactive.setHandler(async (request) => {
      requests.push(request.operation);
      return true;
    });
    expect(await interactive.request({ operation: "shell", description: "run command", command: "echo ok" })).toBe(true);
    expect(requests).toEqual(["shell"]);
    expect(await new ApprovalBroker(true).request({ operation: "patch", description: "patch file" })).toBe(true);
  });
});
