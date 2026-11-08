// Boundary validation for tool arguments supplied by a model or transport.
export class ToolArgumentError extends Error {
  readonly code = "INVALID_TOOL_ARGUMENT";
}

export interface PathArguments {
  readonly path: string;
}

export interface WriteArguments extends PathArguments {
  readonly content: string;
}

export interface SearchArguments {
  readonly query: string;
  readonly path?: string;
  readonly maxResults?: number;
}

export interface ShellArguments {
  readonly command: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export function validatePathArguments(input: unknown): PathArguments {
  const record = requireRecord(input);
  return { path: requireString(record.path, "path") };
}

export function validateWriteArguments(input: unknown): WriteArguments {
  const record = requireRecord(input);
  return { path: requireString(record.path, "path"), content: requireString(record.content, "content") };
}

export function validateSearchArguments(input: unknown): SearchArguments {
  const record = requireRecord(input);
  const query = requireString(record.query, "query");
  const pathValue = record.path === undefined ? undefined : requireString(record.path, "path");
  const maxResults = record.maxResults === undefined ? 100 : requireBoundedInteger(record.maxResults, "maxResults", 1, 10_000);
  return { query, ...(pathValue === undefined ? {} : { path: pathValue }), maxResults };
}

export function validateShellArguments(input: unknown): ShellArguments {
  const record = requireRecord(input);
  const timeoutMs = record.timeoutMs === undefined ? 30_000 : requireBoundedInteger(record.timeoutMs, "timeoutMs", 1, 120_000);
  const maxOutputBytes = record.maxOutputBytes === undefined
    ? 1_000_000
    : requireBoundedInteger(record.maxOutputBytes, "maxOutputBytes", 1, 10_000_000);
  return { command: requireString(record.command, "command"), timeoutMs, maxOutputBytes };
}

function requireRecord(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new ToolArgumentError("Arguments must be an object");
  }
  return input as Record<string, unknown>;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new ToolArgumentError(`${name} must be a non-empty string`);
  return value;
}

function requireBoundedInteger(value: unknown, name: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ToolArgumentError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}
