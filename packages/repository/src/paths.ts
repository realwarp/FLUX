import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { FluxError } from "@flux/shared";

const SECRET_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.netrc$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.|$)/i,
  /\.(pem|key|pfx|p12|jks|keystore)$/i,
  /(^|\/)(credentials|secrets?)\.(json|ya?ml|toml|ini)$/i,
  /(^|\/)\.aws\/credentials$/i,
  /(^|\/)\.ssh\//i,
];

export function isSecretPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return SECRET_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

/** Normalize a user-supplied path to be workspace-relative. */
export function normalizeRelative(input: string | undefined): string {
  if (!input || input === "." || input === "./") return "";
  const withoutRoot = input.replace(/^[/\\]+/, "");
  const normalized = path.posix.normalize(toPosix(withoutRoot));
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new FluxError("path-denied", `Path escapes the workspace: ${input}`);
  }
  return normalized.replace(/^\.\//, "");
}

export interface ResolvedPath {
  absolute: string;
  relative: string;
  exists: boolean;
}

/**
 * Resolve a path inside a workspace and enforce the boundary, including
 * symlink targets. Out-of-workspace access requires an explicit override.
 */
export async function resolveInsideWorkspace(
  workspaceRoot: string,
  input: string | undefined,
  options: { allowOutside?: boolean; allowSecret?: boolean } = {},
): Promise<ResolvedPath> {
  const root = path.resolve(workspaceRoot);
  const relative = normalizeRelative(input);
  const absolute = path.resolve(root, relative);

  if (!options.allowOutside) {
    const relativeToRoot = path.relative(root, absolute);
    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
      throw new FluxError("path-denied", `Path is outside the workspace: ${input ?? "."}`);
    }
  }

  const exists = await stat(absolute).then(
    () => true,
    () => false,
  );

  let real = absolute;
  if (exists) {
    real = await realpath(absolute).catch(() => absolute);
    if (!options.allowOutside) {
      const realRoot = await realpath(root).catch(() => root);
      const relReal = path.relative(realRoot, real);
      if (relReal.startsWith("..") || path.isAbsolute(relReal)) {
        throw new FluxError("path-denied", `Path resolves outside the workspace via a link: ${input ?? "."}`);
      }
    }
  }

  const posixRelative = toPosix(path.relative(root, absolute)) || ".";
  if (!options.allowSecret && isSecretPath(posixRelative)) {
    throw new FluxError(
      "path-denied",
      `Refusing to read a credential-like file automatically: ${posixRelative}. Ask the user to share it explicitly.`,
    );
  }

  return { absolute: real, relative: posixRelative, exists };
}

/** Walk up to the nearest directory containing `.git`. */
export async function findRepositoryRoot(start: string): Promise<{ root: string; isGit: boolean }> {
  let current = path.resolve(start);
  while (true) {
    const isGit = await stat(path.join(current, ".git")).then(
      () => true,
      () => false,
    );
    if (isGit) return { root: current, isGit: true };
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return { root: path.resolve(start), isGit: false };
}
