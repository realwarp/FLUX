import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, test } from "bun:test";
import { ApprovalDenied, ApprovalPolicy } from "../../src/safety/approval.js";
import { createWorkspace } from "../../src/safety/workspace.js";
import { createFluxToolDefinitions } from "../../src/tools/pi-tools.js";

describe("Pi custom workspace tool registry", () => {
  test("registers FLUX tools on AgentSession instead of unrestricted built-ins", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flux-agent-"));
    const runtime = await ModelRuntime.create({ refreshOnCreate: false });
    const { session } = await createAgentSession({
      cwd: root,
      modelRuntime: runtime,
      sessionManager: SessionManager.inMemory(root),
      noTools: "builtin",
      customTools: createFluxToolDefinitions(createWorkspace(root), new ApprovalPolicy()),
    });

    expect(session.getToolDefinition("read")?.name).toBe("read");
    expect(session.getToolDefinition("search")?.name).toBe("search");
    expect(session.getToolDefinition("write")?.name).toBe("write");
    expect(session.getToolDefinition("patch")?.name).toBe("patch");
    expect(session.getToolDefinition("shell")?.name).toBe("shell");
    expect(session.getActiveToolNames()).toEqual(["read", "search", "write", "patch", "shell"]);
    expect(session.getActiveToolNames()).not.toContain("bash");
    session.dispose();
  });

  test("routes write approval through the registered tool", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flux-agent-"));
    const approvals: string[] = [];
    const policy = new ApprovalPolicy({
      approve: async (request) => {
        approvals.push(request.operation);
        return true;
      },
    });
    const write = createFluxToolDefinitions(createWorkspace(root), policy).find((tool) => tool.name === "write");
    if (!write) throw new Error("write tool was not registered");

    await write.execute("write-1", { path: "approved.txt", content: "approved" }, undefined, undefined, {} as never);
    expect(await readFile(path.join(root, "approved.txt"), "utf8")).toBe("approved");
    expect(approvals).toEqual(["write"]);
  });

  test("denied write does not modify the workspace", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flux-agent-"));
    const write = createFluxToolDefinitions(createWorkspace(root), new ApprovalPolicy()).find((tool) => tool.name === "write");
    if (!write) throw new Error("write tool was not registered");

    await expect(write.execute("write-2", { path: "denied.txt", content: "denied" }, undefined, undefined, {} as never))
      .rejects.toBeInstanceOf(ApprovalDenied);
    await expect(readFile(path.join(root, "denied.txt"), "utf8")).rejects.toThrow();
  });

  test("describes patch content as a unified diff rather than complete file contents", () => {
    const root = path.join(os.tmpdir(), "flux-metadata-workspace");
    const patch = createFluxToolDefinitions(createWorkspace(root), new ApprovalPolicy())
      .find((tool) => tool.name === "patch");
    if (!patch) throw new Error("patch tool was not registered");
    expect(patch.parameters.properties.content.description).toContain("Unified diff");
    expect(patch.parameters.properties.content.description).toContain("@@");
  });

  test("registered patch only reports success after the file is atomically changed", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "flux-agent-"));
    const file = path.join(root, "target.txt");
    await writeFile(file, "before\n");
    const patch = createFluxToolDefinitions(
      createWorkspace(root),
      new ApprovalPolicy({ allowWrites: true }),
    ).find((tool) => tool.name === "patch");
    if (!patch) throw new Error("patch tool was not registered");

    const result = await patch.execute(
      "patch-1",
      { path: "target.txt", content: "@@ -1 +1 @@\n-before\n+after" },
      undefined,
      undefined,
      {} as never,
    );
    expect(result.content[0]?.text).toBe("Patched target.txt");
    expect(await readFile(file, "utf8")).toBe("after\n");

    await expect(patch.execute(
      "patch-2",
      { path: "target.txt", content: "@@ -1 +1 @@\n-wrong\n+false-success" },
      undefined,
      undefined,
      {} as never,
    )).rejects.toThrow("Patch removal does not match");
    expect(await readFile(file, "utf8")).toBe("after\n");
  });
});
