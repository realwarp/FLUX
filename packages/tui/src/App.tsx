import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { AgentEvent } from "@flux/agent-runtime";
import type { AppEvent, FluxApp } from "@flux/app-core";
import type { ApprovalRequest, ApprovalDecision } from "@flux/permissions";
import { formatTokens, type AgentRole } from "@flux/shared";
import type { SessionRow } from "@flux/persistence";
import { UiApprovalHandler } from "./approvals.ts";

const THEME = {
  bg: "#0b0e14",
  panel: "#11151c",
  border: "#2a3242",
  accent: "#5cc8ff",
  text: "#d7dde8",
  dim: "#6b7688",
  green: "#7ee787",
  yellow: "#f0c674",
  red: "#ff7b72",
  violet: "#bd93f9",
};

type EntryRole = "user" | "assistant" | "reasoning" | "tool" | "plan" | "notice" | "error";

interface Entry {
  id: string;
  role: EntryRole;
  text: string;
  agentId?: string;
}

interface AgentInfo {
  role: AgentRole;
  state: string;
}

interface VerificationInfo {
  command: string;
  exitCode: number;
  durationMs: number;
  status: "passed" | "failed";
}

export interface AppProps {
  app: FluxApp;
  approvals: UiApprovalHandler;
  initialSessionId?: string;
  onExit: () => void;
}

const ROLE_LABEL: Record<EntryRole, string> = {
  user: "you",
  assistant: "flux",
  reasoning: "think",
  tool: "tool",
  plan: "plan",
  notice: "note",
  error: "error",
};

function entryColor(role: EntryRole): string {
  switch (role) {
    case "user":
      return THEME.accent;
    case "assistant":
      return THEME.text;
    case "reasoning":
      return THEME.dim;
    case "tool":
      return THEME.violet;
    case "plan":
      return THEME.yellow;
    case "notice":
      return THEME.yellow;
    case "error":
      return THEME.red;
  }
}

let entrySeq = 0;
function newEntry(role: EntryRole, text: string, agentId?: string): Entry {
  entrySeq += 1;
  return { id: `e${entrySeq}`, role, text, agentId };
}

export function App({ app, approvals, initialSessionId, onExit }: AppProps) {
  const { width, height } = useTerminalDimensions();
  const [sessions, setSessions] = useState<SessionRow[]>(() => app.listSessions(20));
  const [sessionId, setSessionId] = useState<string>(() => {
    if (initialSessionId) return initialSessionId;
    return app.createSession().id;
  });
  const [entries, setEntries] = useState<Entry[]>([]);
  const [agents, setAgents] = useState<Record<string, AgentInfo>>({});
  const [taskState, setTaskState] = useState("idle");
  const [plan, setPlan] = useState<string | null>(null);
  const [verification, setVerification] = useState<VerificationInfo | null>(null);
  const [pending, setPending] = useState<ApprovalRequest | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [focus, setFocus] = useState<"composer" | "sidebar">("composer");
  const [notice, setNotice] = useState<string>("");
  const [fallbackOn, setFallbackOn] = useState(
    () => app.config.fallback.enabled && app.config.fallback.chain.length > 0,
  );

  const runningRef = useRef(false);
  const pendingRef = useRef<ApprovalRequest | undefined>(undefined);
  const controllerRef = useRef<AbortController | null>(null);
  const composerRef = useRef<{ plainText?: string; setText?: (text: string) => void; focus?: () => void } | null>(null);
  const entriesRef = useRef<Entry[]>([]);

  const narrow = width < 92;
  const veryNarrow = width < 66;

  const append = useCallback((entry: Entry) => {
    setEntries((previous) => {
      const next = [...previous, entry].slice(-500);
      entriesRef.current = next;
      return next;
    });
  }, []);

  const appendAgentText = useCallback((agentId: string, text: string, role: "assistant" | "reasoning") => {
    setEntries((previous) => {
      const last = previous[previous.length - 1];
      let next: Entry[];
      if (last && last.role === role && last.agentId === agentId) {
        next = [...previous.slice(0, -1), { ...last, text: last.text + text }];
      } else {
        next = [...previous, newEntry(role, text, agentId)];
      }
      entriesRef.current = next;
      return next.slice(-500);
    });
  }, []);

  const loadSession = useCallback(
    (id: string) => {
      setSessionId(id);
      const messages = app.db.listMessages(id);
      const loaded: Entry[] = messages
        .filter((message) => message.content)
        .map((message) => newEntry(message.role === "tool" ? "tool" : message.role === "assistant" ? "assistant" : "user", message.content));
      setEntries(loaded);
      entriesRef.current = loaded;
      setPlan(null);
      setVerification(null);
      setTaskState("idle");
      setAgents({});
    },
    [app],
  );

  useEffect(() => {
    if (initialSessionId) loadSession(initialSessionId);
  }, [initialSessionId, loadSession]);

  const modelLabel = useMemo(() => {
    try {
      return app.routeSummary("main");
    } catch (error) {
      return error instanceof Error ? `no model: ${error.message.split(".")[0]}` : "no model configured";
    }
  }, [app]);

  const budgetLabel = useMemo(() => {
    const status = app.sessionBudget(sessionId);
    const tokens = status.limits.sessionTokens;
    return tokens
      ? `${formatTokens(status.used.sessionTokens)}/${formatTokens(tokens)} tokens`
      : `${formatTokens(status.used.sessionTokens)} tokens`;
  }, [app, sessionId, entries.length]);

  useEffect(() => approvals.subscribe((request) => {
    pendingRef.current = request;
    setPending(request);
  }), [approvals]);

  useEffect(() => {
    const unsubscribe = app.events.subscribe((event: AppEvent) => {
      if (event.type === "session-created") {
        setSessions(app.listSessions(20));
        return;
      }
      if (event.type === "task-state") {
        setTaskState(event.state);
        return;
      }
      if (event.type === "turn-error") {
        append(newEntry("error", event.message));
        return;
      }
      handleAgentEvent(event, {
        append,
        appendAgentText,
        setAgents,
        setPlan,
        setTaskState,
        setVerification,
      });
    });
    return unsubscribe;
  }, [app, append, appendAgentText]);

  const submit = useCallback(async () => {
    if (runningRef.current) return;
    const value = composerRef.current?.plainText ?? "";
    const prompt = value.trim();
    if (!prompt) return;
    composerRef.current?.setText?.("");
    append(newEntry("user", prompt));
    append(newEntry("assistant", "", "main"));
    runningRef.current = true;
    setRunning(true);
    setTaskState("running");
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      await app.runTurn({
        sessionId,
        prompt,
        approvals,
        signal: controller.signal,
        fallbackEnabled: fallbackOn,
      });
    } catch (error) {
      append(newEntry("error", error instanceof Error ? error.message : String(error)));
    } finally {
      runningRef.current = false;
      setRunning(false);
      controllerRef.current = null;
      setSessions(app.listSessions(20));
    }
  }, [app, approvals, append, sessionId, fallbackOn]);

  const quit = useCallback(() => {
    controllerRef.current?.abort();
    onExit();
  }, [onExit]);

  const decide = useCallback(
    (decision: ApprovalDecision) => {
      approvals.decide(decision);
      setPending(undefined);
      pendingRef.current = undefined;
    },
    [approvals],
  );

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      if (runningRef.current) {
        controllerRef.current?.abort();
        setNotice("Cancelling...");
      } else {
        quit();
      }
      return;
    }
    const request = pendingRef.current;
    if (request) {
      if (key.name === "y") decide("approved");
      else if (key.name === "a") decide("always");
      else if (key.name === "n" || key.name === "escape") decide("rejected");
      return;
    }
    if (key.name === "f1") {
      setShowHelp((value) => !value);
      return;
    }
    if (key.name === "escape") {
      setShowHelp(false);
      return;
    }
    if (key.name === "tab") {
      setFocus((value) => (value === "composer" ? "sidebar" : "composer"));
      return;
    }
    if (key.ctrl && key.name === "n") {
      const session = app.createSession();
      setSessions(app.listSessions(20));
      loadSession(session.id);
      return;
    }
    if (key.ctrl && key.name === "l") {
      loadSession(sessionId);
      return;
    }
    if (key.ctrl && key.name === "u") {
      const status = app.sessionBudget(sessionId);
      append(newEntry("notice", `usage: ${formatTokens(status.used.sessionTokens)} tokens, ${status.used.sessionRequests} requests — ${status.message}`));
      return;
    }
    if (key.ctrl && key.name === "f") {
      if (!app.config.fallback.enabled || app.config.fallback.chain.length === 0) {
        setNotice("Fallback is not configured (flux models fallback ...)");
        return;
      }
      setFallbackOn((value) => {
        const next = !value;
        setNotice(`fallback ${next ? "enabled" : "disabled"} for this session`);
        return next;
      });
      return;
    }
  });

  useEffect(() => {
    if (focus === "composer") composerRef.current?.focus?.();
  }, [focus]);

  const visibleSessions = sessions.slice(0, 8);
  const agentList = Object.entries(agents);

  return (
    <box style={{ width: "100%", height: "100%", flexDirection: "column", backgroundColor: THEME.bg }}>
      <box
        style={{
          height: 3,
          flexDirection: "row",
          justifyContent: "space-between",
          paddingLeft: 1,
          paddingRight: 1,
          border: true,
          borderColor: THEME.border,
        }}
      >
        <text fg={THEME.accent}>FLUX</text>
        <text fg={THEME.dim}>
          {app.repo.root}
          {app.repo.isGit ? "" : " (no git)"}
        </text>
        <text fg={THEME.text}>{modelLabel}</text>
      </box>

      <box style={{ flexGrow: 1, flexDirection: "row", minHeight: 0 }}>
        {!veryNarrow ? (
          <box
            style={{
              width: narrow ? 18 : 24,
              flexDirection: "column",
              border: true,
              borderColor: focus === "sidebar" ? THEME.accent : THEME.border,
              paddingLeft: 1,
            }}
          >
            <text fg={THEME.accent}>Sessions</text>
            {visibleSessions.map((session) => (
              <box key={session.id} onMouseDown={() => loadSession(session.id)}>
                <text fg={session.id === sessionId ? THEME.green : THEME.dim}>
                  {session.id === sessionId ? "› " : "  "}
                  {session.title.slice(0, narrow ? 12 : 18)}
                </text>
              </box>
            ))}
            <text fg={THEME.accent}>Agents</text>
            {agentList.length === 0 ? <text fg={THEME.dim}>  main · idle</text> : null}
            {agentList.map(([id, info]) => (
              <text key={id} fg={info.state === "failed" ? THEME.red : info.state === "working" ? THEME.green : THEME.dim}>
                {"  "}
                {info.role} · {info.state}
              </text>
            ))}
            <box style={{ flexGrow: 1 }} />
            <box onMouseDown={() => { const session = app.createSession(); setSessions(app.listSessions(20)); loadSession(session.id); }}>
              <text fg={THEME.accent}>[+] new session</text>
            </box>
            <box onMouseDown={() => setShowHelp(true)}>
              <text fg={THEME.accent}>[?] help</text>
            </box>
          </box>
        ) : null}

        <box style={{ flexGrow: 1, flexDirection: "column", minWidth: 0 }}>
          <box style={{ flexGrow: 1, minHeight: 0, paddingLeft: 1, paddingRight: 1 }}>
            <scrollbox stickyScroll stickyStart="bottom" style={{ flexGrow: 1 }}>
              {entries.length === 0 ? (
                <box style={{ flexDirection: "column", padding: 1 }}>
                  <text fg={THEME.accent}>Welcome to FLUX</text>
                  <text fg={THEME.dim}>Ask FLUX to inspect the repository, plan a change, edit files, run tests, and review the diff.</text>
                  <text fg={THEME.dim}>Tab switches focus · Ctrl+N new session · Ctrl+U usage · F1 help · Ctrl+C quit</text>
                  {app.config.providers.length === 0 ? (
                    <text fg={THEME.yellow}>
                      No provider configured. In another terminal run: flux auth
                    </text>
                  ) : null}
                  {!app.config.defaultModel ? (
                    <text fg={THEME.yellow}>No default model. Run: flux models use &lt;provider&gt; &lt;model&gt;</text>
                  ) : null}
                </box>
              ) : null}
              {entries.map((entry) => (
                <box key={entry.id} style={{ flexDirection: "column", marginBottom: 0 }}>
                  <text fg={entryColor(entry.role)}>
                    {entry.role === "assistant" || entry.role === "reasoning" ? "" : `${ROLE_LABEL[entry.role]} `}
                    {entry.text || (entry.role === "assistant" && running ? "…" : "")}
                  </text>
                </box>
              ))}
            </scrollbox>
          </box>

          <box
            style={{
              height: 5,
              border: true,
              borderColor: focus === "composer" ? THEME.accent : THEME.border,
              paddingLeft: 1,
              paddingRight: 1,
              flexDirection: "column",
            }}
          >
            <textarea
              ref={composerRef as never}
              focused={focus === "composer" && !pending}
              placeholder={running ? "FLUX is working… (Ctrl+C to cancel)" : "Ask FLUX to inspect, plan, edit, test or review…"}
              placeholderColor={THEME.dim}
              textColor={THEME.text}
              focusedTextColor={THEME.text}
              backgroundColor={THEME.bg}
              focusedBackgroundColor={THEME.bg}
              cursorColor={THEME.accent}
              keyBindings={[
                { name: "return", ctrl: true, action: "submit" },
                { name: "return", meta: true, action: "submit" },
              ]}
              onSubmit={() => {
                void submit();
              }}
              style={{ height: 3 }}
            />
          </box>
        </box>

        {!narrow ? (
          <box
            style={{
              width: 30,
              flexDirection: "column",
              border: true,
              borderColor: THEME.border,
              paddingLeft: 1,
            }}
          >
            <text fg={THEME.accent}>Inspector</text>
            <text fg={THEME.dim}>task: {taskState}</text>
            <text fg={THEME.dim}>budget: {budgetLabel}</text>
            <text fg={THEME.dim}>mode: {app.config.ui.permissionMode ?? "ask"}</text>
            <text fg={THEME.dim}>
              fallback: {fallbackOn ? "on" : "off"}
              {app.config.fallback.enabled ? " (Ctrl+F)" : " (not configured)"}
            </text>
            <text fg={THEME.accent}>Verification</text>
            {verification ? (
              <text fg={verification.status === "passed" ? THEME.green : THEME.red}>
                {verification.status === "passed" ? "✓" : "✗"} exit {verification.exitCode} · {verification.durationMs}ms{"\n"}
                {verification.command.slice(0, 80)}
              </text>
            ) : (
              <text fg={THEME.dim}>no command run yet</text>
            )}
            <text fg={THEME.accent}>Plan</text>
            <text fg={plan ? THEME.yellow : THEME.dim}>{plan ? plan.slice(0, 500) : "no approved plan yet"}</text>
            <text fg={THEME.accent}>Changed files</text>
            <text fg={THEME.dim}>
              {entries.filter((entry) => entry.role === "tool" && /Wrote|Patch applied/.test(entry.text)).length} edit actions
            </text>
            <text fg={THEME.accent}>Providers</text>
            {app.config.providers.length === 0 ? <text fg={THEME.yellow}>none — run flux auth</text> : null}
            {app.config.providers.slice(0, 6).map((profile) => (
              <text key={profile.id} fg={THEME.dim}>
                {profile.enabled ? "•" : "○"} {profile.displayName}
              </text>
            ))}
          </box>
        ) : null}
      </box>

      <box
        style={{
          height: 1,
          flexDirection: "row",
          justifyContent: "space-between",
          paddingLeft: 1,
          paddingRight: 1,
          backgroundColor: THEME.panel,
        }}
      >
        <text fg={THEME.dim}>
          {running ? "working…" : "ready"} | {sessionId.slice(0, 10)} | {budgetLabel} | {entries.length} lines
        </text>
        <text fg={THEME.dim}>{notice || "Ctrl+Enter send · Tab focus · F1 help · Ctrl+C quit"}</text>
      </box>

      {pending ? (
        <ApprovalDialog request={pending} onDecide={decide} height={height} />
      ) : null}

      {showHelp ? (
        <HelpOverlay onClose={() => setShowHelp(false)} modelLabel={modelLabel} width={width} height={height} />
      ) : null}
    </box>
  );
}

function handleAgentEvent(
  event: AgentEvent,
  helpers: {
    append: (entry: Entry) => void;
    appendAgentText: (agentId: string, text: string, role: "assistant" | "reasoning") => void;
    setAgents: React.Dispatch<React.SetStateAction<Record<string, AgentInfo>>>;
    setPlan: React.Dispatch<React.SetStateAction<string | null>>;
    setTaskState: React.Dispatch<React.SetStateAction<string>>;
    setVerification: React.Dispatch<React.SetStateAction<VerificationInfo | null>>;
  },
): void {
  switch (event.type) {
    case "text":
      helpers.appendAgentText(event.agentId, event.text, "assistant");
      break;
    case "reasoning":
      helpers.appendAgentText(event.agentId, event.text, "reasoning");
      break;
    case "tool-call":
      helpers.append(newEntry("tool", `→ ${event.call.name} ${event.call.arguments.slice(0, 200)}`, event.agentId));
      break;
    case "tool-result":
      helpers.append(
        newEntry("tool", `${event.ok ? "✓" : "✗"} ${event.call.name}: ${event.content.split("\n").slice(0, 4).join("\n").slice(0, 500)}`, event.agentId),
      );
      break;
    case "plan":
      helpers.setPlan(`${event.plan}${event.steps.length ? `\n${event.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}` : ""}`);
      helpers.append(newEntry("plan", `proposed: ${event.plan}`, event.agentId));
      helpers.setTaskState("awaiting_approval");
      break;
    case "notice":
      if (event.level !== "info") helpers.append(newEntry(event.level === "error" ? "error" : "notice", event.message));
      break;
    case "fallback":
      helpers.append(newEntry("notice", `fallback: ${event.from} → ${event.to} (${event.reason})`));
      break;
    case "verification":
      helpers.setVerification({
        command: event.command,
        exitCode: event.exitCode,
        durationMs: event.durationMs,
        status: event.status,
      });
      helpers.append(
        newEntry(
          event.status === "passed" ? "notice" : "error",
          `verify ${event.status === "passed" ? "✓" : "✗"} ${event.command.slice(0, 120)} (exit ${event.exitCode}, ${event.durationMs}ms)`,
        ),
      );
      break;
    case "agent-state":
      helpers.setAgents((previous) => ({ ...previous, [event.agentId]: { role: event.role, state: event.state } }));
      break;
    case "agent-start":
      helpers.setAgents((previous) => ({ ...previous, [event.agentId]: { role: event.role, state: "working" } }));
      break;
    case "agent-done":
      helpers.setAgents((previous) => ({
        ...previous,
        [event.agentId]: { role: event.role, state: event.state },
      }));
      break;
    case "usage":
      break;
  }
}

function ApprovalDialog({
  request,
  onDecide,
  height,
}: {
  request: ApprovalRequest;
  onDecide: (decision: ApprovalDecision) => void;
  height: number;
}) {
  const maxBody = Math.max(6, Math.min(24, height - 12));
  return (
    <box
      style={{
        position: "absolute",
        left: 2,
        right: 2,
        top: 3,
        height: maxBody + 6,
        border: true,
        borderColor: THEME.yellow,
        backgroundColor: THEME.panel,
        flexDirection: "column",
        padding: 1,
      }}
    >
      <text fg={THEME.yellow}>Approval required — {request.title}</text>
      <text fg={THEME.dim}>{request.detail}</text>
      <text fg={THEME.text}>{request.subject.slice(0, maxBody * 80).slice(0, 4000)}</text>
      {request.diff ? <text fg={THEME.dim}>{request.diff.slice(0, 2000)}</text> : null}
      <box style={{ flexDirection: "row", gap: 2 }}>
        <box onMouseDown={() => onDecide("approved")}>
          <text fg={THEME.green}>[y] approve</text>
        </box>
        <box onMouseDown={() => onDecide("always")}>
          <text fg={THEME.accent}>[a] always (this command)</text>
        </box>
        <box onMouseDown={() => onDecide("rejected")}>
          <text fg={THEME.red}>[n] reject</text>
        </box>
      </box>
    </box>
  );
}

function HelpOverlay({
  onClose,
  modelLabel,
  width,
  height,
}: {
  onClose: () => void;
  modelLabel: string;
  width: number;
  height: number;
}) {
  const lines = [
    "FLUX — keyboard and mouse",
    "",
    "Ctrl+Enter  send prompt        Tab        switch composer/sidebar",
    "Ctrl+C      cancel / quit      Ctrl+N     new session",
    "Ctrl+U      show usage         Ctrl+L     reload current session",
    "Ctrl+F      toggle fallback for this session",
    "F1 / Esc    help              Mouse      click sessions, buttons, dialogs",
    "",
    `Active route: ${modelLabel}`,
    "",
    "Provider management (separate terminal):",
    "  flux auth                 guided setup",
    "  flux providers test <id>  one minimal capability probe",
    "  flux models use <p> <m>   default model",
    "  flux models role <role> <p> <m>  per-role override",
    "  flux usage                usage + budgets",
    "",
    "Safety: reads are allowed; writes, patches and shell commands ask for approval.",
    "Destructive commands (reset --hard, force-push, broad deletes) are always denied.",
    "",
    "Press Esc or click anywhere here to close.",
  ];
  return (
    <box
      onMouseDown={onClose}
      style={{
        position: "absolute",
        left: Math.max(1, Math.floor((width - Math.min(width - 2, 78)) / 2)),
        top: Math.max(1, Math.floor((height - lines.length - 4) / 2)),
        width: Math.min(width - 2, 78),
        height: Math.min(height - 2, lines.length + 2),
        border: true,
        borderColor: THEME.accent,
        backgroundColor: THEME.panel,
        flexDirection: "column",
        padding: 1,
      }}
    >
      {lines.map((line, index) => (
        <text key={index} fg={index === 0 ? THEME.accent : THEME.text}>
          {line}
        </text>
      ))}
    </box>
  );
}
