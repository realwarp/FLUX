const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // Authorization headers / bearer tokens
  [/\b(Bearer)\s+[A-Za-z0-9\-._~+/]{12,}=*/gi, "$1 [REDACTED]"],
  [/\b(Authorization)\s*[:=]\s*["']?[^\s"',;]+/gi, "$1: [REDACTED]"],
  // Common key shapes
  [/\bsk-[A-Za-z0-9\-_]{12,}\b/g, "[REDACTED_API_KEY]"],
  [/\bsk-ant-[A-Za-z0-9\-_]{12,}\b/g, "[REDACTED_API_KEY]"],
  [/\b(ghp|gho|ghu|ghs)_[A-Za-z0-9]{20,}\b/g, "[REDACTED_TOKEN]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED_SLACK_TOKEN]"],
  // Key/value assignments (api_key=..., token: "...")
  [
    /\b([A-Za-z0-9_]*(?:api[_-]?key|token|secret|password|passwd|credential)[A-Za-z0-9_]*)\b\s*[:=]\s*["']?[^\s"',;]{6,}["']?/gi,
    "$1=[REDACTED]",
  ],
];

/** Remove credential-like strings from text that may be logged or shown. */
export function redactSecrets(input: string): string {
  let output = input;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

/** Redact values for known environment variable names. */
export function redactEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)/i.test(key)) {
      out[key] = "[REDACTED]";
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Never render raw error payloads that might echo an Authorization header. */
export function redactError(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return redactSecrets(text);
}
