import { readFile } from "node:fs/promises";
import path from "node:path";

interface IgnoreRule {
  regex: RegExp;
  negated: boolean;
  dirOnly: boolean;
}

/** Default exclusions for repository context and tool traversal. */
export const DEFAULT_IGNORES = [
  ".git/",
  "node_modules/",
  "bower_components/",
  "vendor/",
  "dist/",
  "build/",
  "out/",
  "coverage/",
  ".next/",
  ".nuxt/",
  ".svelte-kit/",
  ".turbo/",
  ".cache/",
  ".venv/",
  "venv/",
  "__pycache__/",
  "*.pyc",
  "target/",
  "bin/",
  "obj/",
  ".idea/",
  ".vscode/",
  "*.log",
  "*.min.js",
  "*.map",
  "*.lock",
  "package-lock.json",
  "bun.lock",
  "bun.lockb",
  "pnpm-lock.yaml",
  "yarn.lock",
  "*.png",
  "*.jpg",
  "*.jpeg",
  "*.gif",
  "*.webp",
  "*.ico",
  "*.pdf",
  "*.zip",
  "*.gz",
  "*.7z",
  "*.exe",
  "*.dll",
  "*.so",
  "*.dylib",
  "*.wasm",
  "*.woff",
  "*.woff2",
  "*.ttf",
  "*.otf",
  "*.mp4",
  "*.mov",
  "*.mp3",
  "*.sqlite",
  "*.db",
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "*.pfx",
  "*.p12",
  "id_rsa",
  "id_ed25519",
  ".npmrc",
  ".netrc",
];

function globToRegex(glob: string): string {
  let out = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index]!;
    if (char === "*") {
      if (glob[index + 1] === "*") {
        out += ".*";
        index += 1;
        if (glob[index + 1] === "/") index += 1;
      } else {
        out += "[^/]*";
      }
    } else if (char === "?") {
      out += "[^/]";
    } else if ("\\^$+()[]{}|.".includes(char)) {
      out += `\\${char}`;
    } else {
      out += char;
    }
  }
  return out;
}

export class IgnoreMatcher {
  private readonly rules: IgnoreRule[] = [];

  constructor(patterns: string[] = []) {
    this.addAll(patterns);
  }

  static async load(root: string, extraFiles: string[] = [".gitignore", ".fluxignore"]): Promise<IgnoreMatcher> {
    const matcher = new IgnoreMatcher(DEFAULT_IGNORES);
    for (const file of extraFiles) {
      const content = await readFile(path.join(root, file), "utf8").catch(() => "");
      if (content) matcher.addAll(content.split(/\r?\n/));
    }
    return matcher;
  }

  addAll(patterns: string[]): void {
    for (const raw of patterns) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const negated = line.startsWith("!");
      let pattern = negated ? line.slice(1) : line;
      const dirOnly = pattern.endsWith("/");
      if (dirOnly) pattern = pattern.slice(0, -1);
      if (!pattern) continue;

      const anchored = pattern.startsWith("/");
      pattern = pattern.replace(/^\/+/, "");
      const hasSlash = pattern.includes("/");

      let body: string;
      if (!hasSlash) {
        // Match at any depth: basename or directory segment.
        body = `(?:^|/)${globToRegex(pattern)}(?:/|$)`;
      } else if (anchored) {
        body = `^${globToRegex(pattern)}(?:/|$)`;
      } else {
        body = `(?:^|/)${globToRegex(pattern)}(?:/|$)`;
      }
      this.rules.push({ regex: new RegExp(body), negated, dirOnly });
    }
  }

  /** Returns true when the relative POSIX path should be ignored. */
  ignores(relativePath: string, isDirectory = false): boolean {
    let ignored = false;
    for (const rule of this.rules) {
      if (rule.dirOnly && !isDirectory) {
        // A dir-only rule still ignores descendants; test ancestor segments.
        if (!rule.regex.test(`${relativePath}/`)) continue;
      } else if (!rule.regex.test(relativePath)) {
        continue;
      }
      ignored = !rule.negated;
    }
    return ignored;
  }
}
