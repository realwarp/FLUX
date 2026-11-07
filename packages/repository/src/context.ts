import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { FluxError, truncate } from "@flux/shared";
import { IgnoreMatcher } from "./ignore.ts";
import { findRepositoryRoot, resolveInsideWorkspace, toPosix } from "./paths.ts";

const execFileAsync = promisify(execFile);

export interface FileEntry {
  path: string;
  size: number;
}

export interface SearchHit {
  path: string;
  line: number;
  text: string;
}

export interface ReadResult {
  path: string;
  content: string;
  truncated: boolean;
  bytes: number;
  totalLines: number;
}

const MANIFESTS = [
  "package.json",
  "tsconfig.json",
  "bunfig.toml",
  "pyproject.toml",
  "requirements.txt",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "Gemfile",
  "composer.json",
  "Makefile",
  "docker-compose.yml",
  "Dockerfile",
  ".github/workflows",
];

/** Ignore-aware, read-only view of a repository. */
export class RepositoryContext {
  private constructor(
    readonly root: string,
    readonly isGit: boolean,
    private readonly ignore: IgnoreMatcher,
  ) {}

  static async create(cwd: string): Promise<RepositoryContext> {
    const { root, isGit } = await findRepositoryRoot(cwd);
    const ignore = await IgnoreMatcher.load(root);
    return new RepositoryContext(root, isGit, ignore);
  }

  ignores(relativePath: string, isDirectory = false): boolean {
    return this.ignore.ignores(toPosix(relativePath), isDirectory);
  }

  async listFiles(options: { subPath?: string; maxEntries?: number; maxDepth?: number; includeIgnored?: boolean } = {}): Promise<FileEntry[]> {
    const start = options.subPath ? (await resolveInsideWorkspace(this.root, options.subPath)).absolute : this.root;
    const maxEntries = Math.min(options.maxEntries ?? 500, 5000);
    const maxDepth = Math.min(options.maxDepth ?? 6, 20);
    const files: FileEntry[] = [];
    const queue: Array<{ dir: string; depth: number }> = [{ dir: start, depth: 0 }];

    while (queue.length > 0 && files.length < maxEntries) {
      const current = queue.shift()!;
      let entries: import("node:fs").Dirent[];
      try {
        entries = await readdir(current.dir, { withFileTypes: true });
      } catch {
        continue;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (files.length >= maxEntries) break;
        const absolute = path.join(current.dir, entry.name);
        const relative = toPosix(path.relative(this.root, absolute));
        const directory = entry.isDirectory();
        if (!options.includeIgnored && this.ignore.ignores(relative, directory)) continue;
        if (entry.isSymbolicLink()) continue;
        if (directory) {
          if (current.depth + 1 <= maxDepth) queue.push({ dir: absolute, depth: current.depth + 1 });
          continue;
        }
        if (!entry.isFile()) continue;
        const info = await stat(absolute).catch(() => undefined);
        if (!info) continue;
        if (info.size > 2_000_000) continue;
        files.push({ path: relative, size: info.size });
      }
    }
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }

  async readFile(
    inputPath: string,
    options: { maxBytes?: number; startLine?: number; endLine?: number; allowSecret?: boolean } = {},
  ): Promise<ReadResult> {
    const resolved = await resolveInsideWorkspace(this.root, inputPath, {
      allowSecret: options.allowSecret,
    });
    if (!resolved.exists) throw new FluxError("tool-validation", `File not found: ${resolved.relative}`);
    const info = await stat(resolved.absolute);
    if (!info.isFile()) throw new FluxError("tool-validation", `Not a file: ${resolved.relative}`);
    const maxBytes = options.maxBytes ?? 120_000;
    const buffer = await readFile(resolved.absolute);
    if (buffer.subarray(0, 1024).includes(0)) {
      throw new FluxError("tool-validation", `Refusing to read a binary file: ${resolved.relative}`);
    }
    const truncatedBySize = buffer.byteLength > maxBytes;
    let text = buffer.subarray(0, maxBytes).toString("utf8");
    const allLines = text.split(/\r?\n/);
    const totalLines = truncatedBySize ? allLines.length : allLines.length;
    if (options.startLine || options.endLine) {
      const start = Math.max(1, options.startLine ?? 1);
      const end = Math.max(start, options.endLine ?? allLines.length);
      text = allLines.slice(start - 1, end).join("\n");
    }
    return { path: resolved.relative, content: text, truncated: truncatedBySize, bytes: buffer.byteLength, totalLines };
  }

  async searchText(
    query: string,
    options: { maxHits?: number; glob?: string; caseSensitive?: boolean; regex?: boolean } = {},
  ): Promise<SearchHit[]> {
    if (!query.trim()) return [];
    const maxHits = Math.min(options.maxHits ?? 50, 500);
    const args = ["--line-number", "--no-heading", "--color", "never", "--hidden", "--max-filesize", "2M"];
    if (!options.caseSensitive) args.push("--ignore-case");
    if (!options.regex) args.push("--fixed-strings");
    if (options.glob) args.push("--glob", options.glob);
    for (const pattern of [".git", "node_modules", "dist", "build", ".venv", "target"]) {
      args.push("--glob", `!${pattern}/**`);
    }
    args.push("--", query, ".");

    try {
      const { stdout } = await execFileAsync("rg", args, {
        cwd: this.root,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        timeout: 20_000,
      });
      return this.parseRgOutput(stdout, maxHits);
    } catch (error) {
      const withOutput = error as { stdout?: string; code?: number };
      if (withOutput.stdout) return this.parseRgOutput(withOutput.stdout, maxHits);
      if (withOutput.code === 1) return [];
      // rg missing or failed: portable fallback below.
    }

    const hits: SearchHit[] = [];
    const needle = options.caseSensitive ? query : query.toLowerCase();
    const files = await this.listFiles({ maxEntries: 400 });
    for (const file of files) {
      if (options.glob && !globMatch(file.path, options.glob)) continue;
      let text: string;
      try {
        text = await readFile(path.join(this.root, file.path), "utf8");
      } catch {
        continue;
      }
      if (text.slice(0, 1024).includes("\u0000")) continue;
      const lines = text.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]!;
        const haystack = options.caseSensitive ? line : line.toLowerCase();
        if (haystack.includes(needle)) {
          hits.push({ path: file.path, line: index + 1, text: truncate(line.trim(), 300) });
          if (hits.length >= maxHits) return hits;
        }
      }
    }
    return hits;
  }

  async manifestFiles(): Promise<string[]> {
    const found: string[] = [];
    for (const manifest of MANIFESTS) {
      const exists = await stat(path.join(this.root, manifest)).then(
        () => true,
        () => false,
      );
      if (exists) found.push(manifest);
    }
    return found;
  }

  async summary(maxFiles = 12): Promise<string> {
    const files = await this.listFiles({ maxEntries: maxFiles });
    const manifests = await this.manifestFiles();
    const lines = [
      `Repository root: ${this.root}`,
      `Git repository: ${this.isGit ? "yes" : "no"}`,
      `Project manifests: ${manifests.length > 0 ? manifests.join(", ") : "(none detected)"}`,
      `Files (first ${files.length}):`,
      ...files.map((file) => `  ${file.path} (${file.size} bytes)`),
    ];
    return lines.join("\n");
  }

  private parseRgOutput(stdout: string, maxHits: number): SearchHit[] {
    const hits: SearchHit[] = [];
    for (const line of stdout.split(/\r?\n/)) {
      if (!line) continue;
      const match = /^\.?[/\\]?(.*?):(\d+):(.*)$/.exec(line);
      if (!match) continue;
      hits.push({ path: toPosix(match[1]!), line: Number(match[2]), text: truncate(match[3]!.trim(), 300) });
      if (hits.length >= maxHits) break;
    }
    return hits;
  }
}

function globMatch(filePath: string, glob: string): boolean {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*");
  return new RegExp(`(^|/)${escaped}$`).test(filePath);
}
