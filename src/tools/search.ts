// Search text files within the workspace without following unsafe directory links.
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { ApprovalPolicy } from "../safety/approval.js";
import { validateSearchArguments } from "../safety/validation.js";
import { Workspace } from "../safety/workspace.js";

export interface SearchMatch {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

export async function searchTool(workspace: Workspace, policy: ApprovalPolicy, input: unknown): Promise<SearchMatch[]> {
  const args = validateSearchArguments(input);
  await policy.require({ operation: "search", description: `Search for ${args.query}` });
  const root = await workspace.resolve(args.path ?? ".");
  const matches: SearchMatch[] = [];
  await visit(root);
  return matches;

  async function visit(current: string): Promise<void> {
    if (matches.length >= args.maxResults!) return;
    const contained = await workspace.resolve(path.relative(workspace.root, current));
    const metadata = await stat(contained);
    if (metadata.isDirectory()) {
      const entries = await readdir(contained, { withFileTypes: true });
      await Promise.all(entries
        .filter((entry) => entry.name !== ".git" && entry.name !== "node_modules")
        .map((entry) => visit(path.join(contained, entry.name))));
      return;
    }

    if (!metadata.isFile() || metadata.size > 2_000_000) return;
    const text = await readFile(contained, "utf8").catch(() => undefined);
    if (text === undefined) return;
    text.split(/\r?\n/).forEach((line, index) => {
      if (matches.length < args.maxResults! && line.includes(args.query)) {
        matches.push({ path: path.relative(workspace.root, contained), line: index + 1, text: line });
      }
    });
  }
}

export const searchFilesTool = searchTool;
