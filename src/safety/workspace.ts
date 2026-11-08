// Workspace path resolution and containment checks.
import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import path from "node:path";

export class WorkspaceViolation extends Error {
  readonly code = "WORKSPACE_VIOLATION";
}

export class Workspace {
  readonly root: string;
  private readonly comparisonRoot: string;

  constructor(root: string) {
    if (!path.isAbsolute(root)) throw new WorkspaceViolation("Workspace root must be absolute");
    this.root = path.resolve(root);
    this.comparisonRoot = normalizeForComparison(this.root);
  }

  async resolve(relativePath: string, options: { mustExist?: boolean } = {}): Promise<string> {
    if (typeof relativePath !== "string" || relativePath.length === 0) {
      throw new WorkspaceViolation("Path must be a non-empty string");
    }
    // Validate the lexical path under the configured root, then compare its
    // resolved filesystem ancestor with the canonical root. Keep the returned
    // path in the configured spelling so callers can safely use path.relative().
    const canonicalRoot = await realpath(this.root);
    const candidate = path.resolve(this.root, relativePath);
    assertLexicallyContained(candidate, this.comparisonRoot);
    const checked = await resolveExistingAncestor(candidate);
    assertLexicallyContained(checked, normalizeForComparison(canonicalRoot));
    if (options.mustExist) await access(candidate, constants.F_OK);
    return candidate;
  }
}

export function createWorkspace(root: string): Workspace {
  return new Workspace(root);
}

function normalizeForComparison(value: string): string {
  const normalized = path.normalize(value).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function assertLexicallyContained(candidate: string, root: string): void {
  const normalized = normalizeForComparison(candidate);
  if (normalized !== root && !normalized.startsWith(`${root}${path.sep}`)) {
    throw new WorkspaceViolation(`Path is outside workspace: ${candidate}`);
  }
}

async function resolveExistingAncestor(candidate: string): Promise<string> {
  let current = candidate;
  while (true) {
    try {
      return await realpath(current);
    } catch (error) {
      if (!isMissingPathError(error) || current === path.dirname(current)) throw error;
      current = path.dirname(current);
    }
  }
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
