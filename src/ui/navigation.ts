import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { matchesKey } from "@earendil-works/pi-tui";
import type { ProviderName, FluxConfig } from "../config/providers.js";
import { SessionManager, type ContextUsage, type SessionInfo } from "@earendil-works/pi-coding-agent";

export type PaletteAction =
  | "new-session"
  | "search-files"
  | "show-diff"
  | "show-status"
  | "show-context"
  | "select-model"
  | "switch-session"
  | "resume-session"
  | "help"
  | "exit";

export interface PaletteCommand {
  action: PaletteAction;
  category: string;
  label: string;
  description: string;
}

export interface SearchableItem {
  label: string;
  description?: string;
  searchText?: string;
}

export interface ProviderModel {
  provider: ProviderName;
  modelId?: string;
  model?: Model<any>;
  active: boolean;
  available: boolean;
  description: string;
}

export interface ProviderModelGroup {
  provider: ProviderName;
  available: boolean;
  description: string;
  models: ProviderModel[];
}

export interface ContextPresentation {
  project: string;
  session: string;
  model: string;
  messageCount: number;
  context?: ContextUsage;
  persistence: string;
}

export const PALETTE_COMMANDS: readonly PaletteCommand[] = [
  { action: "new-session", category: "Sessions", label: "New session", description: "Start a separate workspace session" },
  { action: "switch-session", category: "Sessions", label: "Switch session", description: "Open another session from this workspace" },
  { action: "resume-session", category: "Sessions", label: "Resume session", description: "Restore a session and its conversation history" },
  { action: "search-files", category: "Workspace", label: "Search files", description: "Find text inside workspace files" },
  { action: "show-diff", category: "Workspace", label: "Show diff", description: "Inspect the current workspace diff" },
  { action: "show-status", category: "Workspace", label: "Show status", description: "Show project, model, and active session" },
  { action: "show-context", category: "Workspace", label: "Show context", description: "Show message count, context usage, and persistence" },
  { action: "select-model", category: "Models", label: "Select model", description: "Choose a configured provider and model" },
  { action: "help", category: "Help", label: "Help", description: "Show keyboard controls and available actions" },
  { action: "exit", category: "Application", label: "Exit", description: "Close FLUX" },
];

export function isPaletteShortcut(data: string): boolean {
  return matchesKey(data, "ctrl+k");
}

export function resolvePaletteCommand(action: string): PaletteCommand | undefined {
  return PALETTE_COMMANDS.find((command) => command.action === action);
}

export function filterSearchable<T extends SearchableItem>(items: readonly T[], query: string): T[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...items];
  return items
    .map((item, index) => ({ item, index, score: matchScore(searchText(item), needle) }))
    .filter((match) => match.score !== undefined)
    .sort((left, right) => left.score! - right.score! || left.index - right.index)
    .map((match) => match.item);
}

export function buildProviderModelGroups(
  config: FluxConfig,
  activeModel: { provider: string; id: string } | undefined,
  ollamaModelIds?: readonly string[],
): ProviderModelGroup[] {
  return (Object.keys(config.providers) as ProviderName[]).map((provider) => {
    const configured = config.providers[provider];
    if (!configured) {
      return { provider, available: false, description: "Not configured", models: [] };
    }
    if (!configured.enabled) {
      return { provider, available: false, description: "Disabled in FLUX configuration", models: [] };
    }
    const catalogKnown = ollamaModelIds !== undefined;
    const localModelIds = ollamaModelIds ?? [];
    const isConfiguredModelAvailable = provider !== "ollama" || catalogKnown && localModelIds.includes(configured.model);
    const providerDescription = configured.displayName
      ? `${configured.displayName} · ${configured.baseUrl}`
      : configured.baseUrl;
    const ids = provider === "ollama"
      ? [...new Set([configured.model, ...localModelIds])]
      : [configured.model];
    return {
      provider,
      available: isConfiguredModelAvailable,
      description: isConfiguredModelAvailable
        ? providerDescription
        : provider === "ollama" && !catalogKnown
          ? "Local model endpoint unavailable; model availability is unconfirmed"
          : "Configured model is not installed locally",
      models: ids.map((modelId) => ({
        provider,
        modelId,
        active: activeModel?.provider === provider && activeModel.id === modelId,
        available: provider !== "ollama" || !catalogKnown || localModelIds.includes(modelId),
        description: activeModel?.provider === provider && activeModel.id === modelId
          ? "Active model"
          : provider === "ollama" && !catalogKnown
            ? "Configured; local availability unconfirmed"
            : provider === "ollama" && !localModelIds.includes(modelId)
              ? "Configured but not installed locally"
            : "Configured model",
      })),
    };
  });
}

export function createContextPresentation(input: {
  project: string;
  sessionId: string;
  model: string;
  messageCount: number;
  context?: ContextUsage;
  persisted: boolean;
}): ContextPresentation {
  return {
    project: input.project,
    session: input.sessionId,
    model: input.model,
    messageCount: input.messageCount,
    context: input.context,
    persistence: input.persisted ? "Saved to session file" : "Not persisted yet",
  };
}

export function sameWorkspacePath(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const normalized = value.replace(/[\\/]+/g, "\\").replace(/\\$/, "");
    return process.platform === "win32" ? normalized.toLocaleLowerCase() : normalized;
  };
  return normalize(left) === normalize(right);
}

export async function listWorkspaceSessions(cwd: string, sessionDir: string): Promise<SessionInfo[]> {
  try {
    await access(sessionDir, constants.R_OK);
  } catch (error) {
    if (isMissingPathError(error)) return [];
    throw new Error("Cannot access saved sessions for this workspace.", { cause: error });
  }
  const sessions = await SessionManager.list(cwd, sessionDir);
  return sessions.filter((session) => session.cwd !== undefined && session.cwd !== "" && sameWorkspacePath(session.cwd, cwd));
}

export async function openWorkspaceSession(sessionFile: string, cwd: string, sessionDir: string): Promise<SessionManager> {
  const resolvedDir = resolve(sessionDir);
  const resolvedFile = resolve(sessionFile);
  const pathFromSessionDir = relative(resolvedDir, resolvedFile);
  if (!pathFromSessionDir || pathFromSessionDir === ".." ||
    pathFromSessionDir.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(pathFromSessionDir)) {
    throw new Error("The selected session file is outside this workspace's session directory.");
  }
  try {
    await access(resolvedFile, constants.R_OK);
  } catch (error) {
    if (isMissingPathError(error)) throw new Error("The selected session file no longer exists.", { cause: error });
    if (isAccessDeniedError(error)) throw new Error("The selected session file cannot be accessed.", { cause: error });
    throw error;
  }
  const manager = SessionManager.open(resolvedFile, resolvedDir);
  if (!sameWorkspacePath(manager.getCwd(), cwd)) {
    throw new Error("The selected session belongs to a different workspace.");
  }
  return manager;
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function isAccessDeniedError(error: unknown): boolean {
  return error instanceof Error && "code" in error &&
    ((error as NodeJS.ErrnoException).code === "EACCES" || (error as NodeJS.ErrnoException).code === "EPERM");
}

function searchText(item: SearchableItem): string {
  return `${item.label} ${item.description ?? ""} ${item.searchText ?? ""}`.toLocaleLowerCase();
}

function matchScore(text: string, needle: string): number | undefined {
  const substringIndex = text.indexOf(needle);
  if (substringIndex >= 0) return substringIndex;
  let position = 0;
  for (const character of needle) {
    position = text.indexOf(character, position);
    if (position < 0) return undefined;
    position += 1;
  }
  return 10_000 + position;
}
