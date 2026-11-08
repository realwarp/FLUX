import { Type } from "typebox";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { ApprovalPolicy, type ApprovalRequest } from "../safety/approval.js";
import { Workspace } from "../safety/workspace.js";
import { patchTool } from "./patch.js";
import { readTool } from "./read.js";
import { searchTool } from "./search.js";
import { shellTool } from "./shell.js";
import { writeTool } from "./write.js";

export class ApprovalBroker {
  private handler?: (request: ApprovalRequest) => Promise<boolean>;

  constructor(private readonly automatic = false) {}

  setHandler(handler: (request: ApprovalRequest) => Promise<boolean>): void {
    this.handler = handler;
  }

  async request(request: ApprovalRequest): Promise<boolean> {
    if (this.automatic) return true;
    return this.handler ? this.handler(request) : false;
  }
}

const readParameters = Type.Object({
  path: Type.String({ description: "Workspace-relative file path to read." }),
});

const searchParameters = Type.Object({
  query: Type.String({ description: "Text to search for." }),
  path: Type.Optional(Type.String({ description: "Workspace-relative directory or file path." })),
  maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000, description: "Maximum matches to return." })),
});

const writeParameters = Type.Object({
  path: Type.String({ description: "Workspace-relative file path to write." }),
  content: Type.String({ description: "Complete file content." }),
});

const patchParameters = Type.Object({
  path: Type.String({ description: "Workspace-relative path of the existing file to patch." }),
  content: Type.String({ description: "Unified diff text with @@ hunk headers and exact context lines; patch one file only." }),
});

const shellParameters = Type.Object({
  command: Type.String({ description: "Bounded command to run from the workspace root." }),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 120_000 })),
  maxOutputBytes: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000_000 })),
});

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: undefined };
}

export function createFluxToolDefinitions(workspace: Workspace, policy: ApprovalPolicy): ToolDefinition[] {
  return [
    defineTool({
      name: "read",
      label: "Read",
      description: "Read a UTF-8 text file inside the current workspace.",
      promptSnippet: "Read workspace files",
      parameters: readParameters,
      execute: async (_toolCallId, params) => textResult(await readTool(workspace, policy, params)),
    }),
    defineTool({
      name: "search",
      label: "Search",
      description: "Search workspace text files for a string without leaving the workspace.",
      promptSnippet: "Search workspace text",
      parameters: searchParameters,
      execute: async (_toolCallId, params) => textResult(JSON.stringify(await searchTool(workspace, policy, params), null, 2)),
    }),
    defineTool({
      name: "write",
      label: "Write",
      description: "Write a complete workspace file after explicit approval.",
      promptSnippet: "Write approved workspace files",
      parameters: writeParameters,
      executionMode: "sequential",
      execute: async (_toolCallId, params) => {
        await writeTool(workspace, policy, params);
        return textResult(`Wrote ${params.path}`);
      },
    }),
    defineTool({
      name: "patch",
      label: "Patch",
      description: "Apply a unified diff with matching hunk context to one workspace file after explicit approval.",
      promptSnippet: "Apply unified diff patches to approved workspace files",
      parameters: patchParameters,
      executionMode: "sequential",
      execute: async (_toolCallId, params) => {
        await patchTool(workspace, policy, params);
        return textResult(`Patched ${params.path}`);
      },
    }),
    defineTool({
      name: "shell",
      label: "Shell",
      description: "Run a bounded workspace-relative shell command after explicit approval.",
      promptSnippet: "Run approved bounded shell commands",
      parameters: shellParameters,
      execute: async (_toolCallId, params) => textResult(JSON.stringify(await shellTool(workspace, policy, params))),
    }),
  ];
}
