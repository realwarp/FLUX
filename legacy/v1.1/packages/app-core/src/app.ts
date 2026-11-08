import {
  FluxError,
  nowIso,
  describeError,
  type ChatMessage,
  type FluxConfig,
  type ModelCapabilities,
  type PermissionMode,
  type ProviderProfile,
  type TokenUsage,
} from "@flux/shared";
import {
  BudgetManager,
  CredentialResolver,
  ModelRouter,
  OpenAICompatibleProvider,
  ProviderRegistry,
  UsageLedger,
  describeTarget,
  type ModelTarget,
} from "@flux/providers";
import { RepositoryContext } from "@flux/repository";
import { ToolExecutor } from "@flux/tools";
import {
  DenyAllApprovalHandler,
  PermissionPolicy,
  type ApprovalHandler,
} from "@flux/permissions";
import { FluxDatabase, type SessionRow } from "@flux/persistence";
import { runAgent, type AgentEvent, type AgentRunResult } from "@flux/agent-runtime";
import { ConfigManager, resolveFluxPaths, type FluxPaths } from "./config.ts";
import { EventBus } from "./events.ts";

export interface FluxAppOptions {
  cwd?: string;
  paths?: FluxPaths;
  config?: FluxConfig;
  db?: FluxDatabase;
  env?: NodeJS.ProcessEnv;
  approvals?: ApprovalHandler;
  permissionMode?: FluxConfig["ui"]["permissionMode"];
  fallbackEnabled?: boolean;
  maxSteps?: number;
}

export interface RunTurnInput {
  sessionId: string;
  prompt: string;
  role?: "main" | "explore" | "planner" | "implementer" | "reviewer" | "tester";
  approvals?: ApprovalHandler;
  signal?: AbortSignal;
  /** Per-session override. Omit to follow config. */
  fallbackEnabled?: boolean;
}

export interface TurnResult {
  sessionId: string;
  taskId: string;
  result: AgentRunResult;
}

export interface ProviderTestResult {
  ok: boolean;
  message: string;
  latencyMs: number;
  models: string[];
  capabilities?: ModelCapabilities;
}

/** Wires configuration, providers, tools, agent runtime, persistence and events. */
export class FluxApp {
  readonly paths: FluxPaths;
  readonly configManager: ConfigManager;
  readonly db: FluxDatabase;
  readonly repo: RepositoryContext;
  readonly registry: ProviderRegistry;
  readonly tools = new ToolExecutor();
  readonly ledger: UsageLedger;
  readonly events = new EventBus();

  private userConfig: FluxConfig;
  private effectiveConfig: FluxConfig;
  private router: ModelRouter;
  private readonly credentials: CredentialResolver;
  private readonly provider: OpenAICompatibleProvider;
  private readonly ownsDb: boolean;
  private readonly maxSteps?: number;
  private readonly defaultApprovals: ApprovalHandler;
  private readonly mode: PermissionMode;

  private constructor(options: FluxAppOptions, repo: RepositoryContext) {
    const env = options.env ?? process.env;
    this.paths = options.paths ?? resolveFluxPaths(env);
    this.configManager = new ConfigManager(this.paths, options.cwd ?? process.cwd());
    this.userConfig = options.config ?? this.configManager.loadUser();
    this.effectiveConfig = options.config ?? this.configManager.load();
    this.db = options.db ?? new FluxDatabase(this.paths.dbFile);
    this.ownsDb = !options.db;
    this.repo = repo;
    this.maxSteps = options.maxSteps;
    this.credentials = new CredentialResolver(env);
    this.provider = new OpenAICompatibleProvider({ credentials: this.credentials });
    this.router = new ModelRouter(this.effectiveConfig);
    this.ledger = new UsageLedger(this.db.listUsage());
    this.registry = new ProviderRegistry(this.userConfig, (next) => {
      this.userConfig = next;
      this.configManager.save(next);
      this.effectiveConfig = this.configManager.applyProject(next);
      this.router = new ModelRouter(this.effectiveConfig);
    });
    this.defaultApprovals = options.approvals ?? new DenyAllApprovalHandler();
    this.mode = options.permissionMode ?? this.effectiveConfig.ui.permissionMode ?? "ask";
  }

  static async create(options: FluxAppOptions = {}): Promise<FluxApp> {
    const repo = await RepositoryContext.create(options.cwd ?? process.cwd());
    return new FluxApp(options, repo);
  }

  get config(): FluxConfig {
    return this.effectiveConfig;
  }

  get budgets(): BudgetManager {
    return new BudgetManager(this.effectiveConfig.budgets, this.ledger);
  }

  permissionPolicy(trusted: string[] = []): PermissionPolicy {
    return new PermissionPolicy({
      mode: this.mode,
      trustedCommands: trusted,
    });
  }

  sessionBudget(sessionId: string) {
    return this.budgets.evaluate({ sessionId });
  }

  createSession(input: { title?: string } = {}): SessionRow {
    const session = this.db.createSession({
      cwd: this.repo.root,
      title: input.title,
      defaultModel: this.effectiveConfig.defaultModel,
    });
    this.events.emit({ type: "session-created", session });
    return session;
  }

  getSession(id: string): SessionRow {
    const session = this.db.getSession(id);
    if (!session) throw new FluxError("config", `Session not found: ${id}`);
    return session;
  }

  listSessions(limit = 50): SessionRow[] {
    return this.db.listSessions(limit);
  }

  searchSessions(query: string, limit = 50): SessionRow[] {
    return this.db.searchSessions(query, limit);
  }

  deleteSession(id: string): void {
    this.db.deleteSession(id);
  }

  historyFor(sessionId: string): ChatMessage[] {
    return this.db
      .listMessages(sessionId)
      .filter((message) => !(message.role === "tool" && !message.toolCallId))
      .map((message) => ({
        role: message.role,
        content: message.content,
        ...(message.toolCalls ? { toolCalls: message.toolCalls } : {}),
        ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
      }));
  }

  async runTurn(input: RunTurnInput): Promise<TurnResult> {
    const session = this.getSession(input.sessionId);
    if (!this.effectiveConfig.defaultModel && Object.keys(this.effectiveConfig.roles).length === 0) {
      throw new FluxError(
        "config",
        "No model configured. Run `flux auth` (or `flux providers add`) and select a default model first.",
      );
    }

    this.db.appendMessage({ sessionId: session.id, role: "user", content: input.prompt });
    const task = this.db.createTask({ sessionId: session.id, title: input.prompt.slice(0, 80) });
    this.updateTaskState(task.id, "running");

    const approvals = input.approvals ?? this.defaultApprovals;
    const policy = this.permissionPolicy();
    const fallbackEnabled =
      (input.fallbackEnabled ?? true) &&
      this.effectiveConfig.fallback.enabled &&
      this.effectiveConfig.fallback.chain.length > 0;
    const history = this.historyFor(session.id).slice(0, -1);
    const emit = (event: AgentEvent): void => {
      if (event.type === "plan") this.updateTaskState(task.id, "awaiting_approval");
      if (event.type === "tool-call") this.updateTaskState(task.id, "running");
      if (event.type === "agent-done" && event.role === "main") {
        this.updateTaskState(task.id, event.state === "completed" ? "completed" : event.state === "cancelled" ? "cancelled" : "failed");
      }
      this.events.emit(event);
    };

    try {
      const result = await runAgent(
        {
          router: this.router,
          providerFor: () => this.provider,
          tools: this.tools,
          toolContext: {
            repo: this.repo,
            policy,
            approvals,
            onNotice: (message) => emit({ type: "notice", level: "info", message }),
          },
          ledger: this.ledger,
          budgets: this.budgets,
          approvals,
          db: this.db,
          repo: this.repo,
          fallbackEnabled,
          emit,
          maxSteps: this.maxSteps,
          delegation: async (request, _parentAgentId) =>
            runAgent(
              {
                router: this.router,
                providerFor: () => this.provider,
                tools: this.tools,
                toolContext: { repo: this.repo, policy, approvals },
                ledger: this.ledger,
                budgets: this.budgets,
                approvals,
                db: this.db,
                repo: this.repo,
                fallbackEnabled,
                emit,
                maxSteps: 6,
              },
              {
                role: request.role,
                prompt: request.prompt,
                sessionId: request.sessionId,
                taskId: request.taskId,
                history: request.history,
                depth: request.depth,
                signal: input.signal,
              },
            ),
        },
        {
          role: input.role ?? "main",
          prompt: input.prompt,
          sessionId: session.id,
          taskId: task.id,
          history,
          signal: input.signal,
        },
      );

      if (session.title === "New session") {
        this.db.updateSession(session.id, { title: input.prompt.slice(0, 60) });
      }
      this.db.updateSession(session.id, { status: result.state === "completed" ? "active" : "failed" });
      return { sessionId: session.id, taskId: task.id, result };
    } catch (error) {
      this.updateTaskState(task.id, "failed", describeError(error));
      this.events.emit({ type: "turn-error", message: redact(describeError(error)) });
      throw error;
    }
  }

  usageSummary(sessionId?: string) {
    return this.ledger.summarize(sessionId ? { sessionId } : {});
  }

  usageByProvider() {
    return this.ledger.groupByProvider();
  }

  routeFor(role: Parameters<ModelRouter["resolve"]>[0]): ModelTarget {
    return this.router.resolve(role);
  }

  routeSummary(role: Parameters<ModelRouter["resolve"]>[0]): string {
    const target = this.router.resolve(role);
    const fallbacks = this.router.fallbackChain(role);
    const enabled = this.effectiveConfig.fallback.enabled && this.effectiveConfig.fallback.chain.length > 0;
    const head = describeTarget(target);
    if (!enabled || fallbacks.length === 0) return head;
    return `${head} → ${fallbacks.map(describeTarget).join(" → ")}`;
  }

  /** Probe a provider with one minimal request and record verified capabilities. */
  async testProvider(providerId: string, modelId?: string): Promise<ProviderTestResult> {
    const profile = this.registry.get(providerId);
    const started = Date.now();
    const models: string[] = [];
    try {
      const listed = await this.provider.listModels(profile).catch(() => []);
      models.push(...listed);
    } catch {
      // Model listing is optional.
    }
    const model = modelId ?? profile.defaultModelId ?? models[0] ?? profile.models[0];
    if (!model) {
      const message = "No model specified and the endpoint did not list any models.";
      this.registry.recordTest(providerId, false, message);
      return { ok: false, message, latencyMs: Date.now() - started, models };
    }
    try {
      const capabilities = await this.provider.probe(profile, model);
      this.registry.setCapabilities(providerId, model, capabilities);
      this.registry.recordTest(providerId, true, `Reachable; model ${model} responded.`);
      return {
        ok: true,
        message: `Reachable; model ${model} responded. streaming=${capabilities.streaming}, toolCalls=${capabilities.toolCalls}, usage=${capabilities.usageReporting}`,
        latencyMs: Date.now() - started,
        models,
        capabilities,
      };
    } catch (error) {
      const message = redact(describeError(error));
      this.registry.recordTest(providerId, false, message);
      return { ok: false, message, latencyMs: Date.now() - started, models };
    }
  }

  async listProviderModels(providerId: string): Promise<string[]> {
    const profile = this.registry.get(providerId);
    return this.provider.listModels(profile);
  }

  resolveCredential(profile: Pick<ProviderProfile, "credentialRef">): string | undefined {
    return this.credentials.resolve(profile.credentialRef);
  }

  credentialStatus(profile: Pick<ProviderProfile, "credentialRef">): boolean {
    return this.credentials.isResolvable(profile.credentialRef);
  }

  recordVerification(input: {
    sessionId: string;
    taskId?: string;
    command: string;
    cwd: string;
    exitCode: number;
    durationMs: number;
    output: string;
    truncated: boolean;
  }): void {
    this.db.recordVerification({
      id: `ver_${Date.now().toString(36)}`,
      sessionId: input.sessionId,
      taskId: input.taskId,
      command: input.command,
      cwd: input.cwd,
      exitCode: input.exitCode,
      durationMs: input.durationMs,
      output: input.output,
      truncated: input.truncated,
      status: input.exitCode === 0 ? "passed" : "failed",
      at: nowIso(),
    });
  }

  close(): void {
    if (this.ownsDb) this.db.close();
  }

  private updateTaskState(taskId: string, state: Parameters<FluxDatabase["setTaskState"]>[1], error?: string): void {
    this.db.setTaskState(taskId, state, error);
    this.events.emit({ type: "task-state", taskId, state });
  }
}

function redact(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]{12,}=*/gi, "Bearer [REDACTED]")
    .replace(/sk-[A-Za-z0-9\-_]{12,}/g, "[REDACTED_API_KEY]");
}

export type { TokenUsage };
