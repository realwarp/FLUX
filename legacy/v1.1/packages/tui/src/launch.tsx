import { createCliRenderer, type CliRenderer } from "@opentui/core";
import { createRoot, type Root } from "@opentui/react";
import { FluxApp } from "@flux/app-core";
import { App } from "./App.tsx";
import { UiApprovalHandler } from "./approvals.ts";

export interface LaunchTuiOptions {
  cwd?: string;
  sessionId?: string;
  permissionMode?: "ask" | "read-only" | "accept-edits";
}

/**
 * Boot the interactive TUI and resolve when the user quits. Owns the lifetime
 * of the renderer, the React root and the FluxApp instance.
 */
export async function launchTui(options: LaunchTuiOptions = {}): Promise<void> {
  const approvals = new UiApprovalHandler();
  const app = await FluxApp.create({
    cwd: options.cwd,
    approvals,
    permissionMode: options.permissionMode,
  });

  let renderer: CliRenderer | undefined;
  let root: Root | undefined;
  let exited = false;
  let resolveDone: (() => void) | undefined;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const cleanup = (): void => {
    if (exited) return;
    exited = true;
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    try {
      root?.unmount();
    } catch {
      // The renderer may already be gone.
    }
    try {
      renderer?.destroy();
    } catch {
      // Terminal restoration is best-effort.
    }
    try {
      app.close();
    } catch {
      // Database close is best-effort.
    }
    resolveDone?.();
  };

  function onSignal(): void {
    cleanup();
  }

  try {
    renderer = await createCliRenderer({
      exitOnCtrlC: false,
      useMouse: true,
      targetFps: 30,
      screenMode: "alternate-screen",
      clearOnShutdown: true,
    });
    root = createRoot(renderer);
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    root.render(
      <App
        app={app}
        approvals={approvals}
        initialSessionId={options.sessionId}
        onExit={cleanup}
      />,
    );
    await done;
  } catch (error) {
    cleanup();
    throw error;
  }
}
