import { FluxError } from "@flux/shared";
import { openApp, paint, parseArgs, table } from "../common.ts";

export async function sessionsCommand(argv: string[]): Promise<void> {
  const { positionals } = parseArgs(argv);
  const action = positionals[0] ?? "list";
  const app = await openApp();
  try {
    if (action === "list") {
      const sessions = app.listSessions();
      if (sessions.length === 0) {
        process.stdout.write("No saved sessions.\n");
        return;
      }
      const rows = [["ID", "UPDATED", "CWD", "TITLE"]];
      for (const session of sessions) {
        rows.push([session.id, session.updatedAt.replace("T", " ").slice(0, 19), session.cwd, session.title]);
      }
      process.stdout.write(`${table(rows)}\n`);
      process.stdout.write(paint.dim("\nResume: flux resume <id>  |  Delete: flux sessions delete <id>\n"));
      return;
    }

    const id = positionals[1];
    if (!id) throw new FluxError("config", `Usage: flux sessions ${action} <session-id>`);

    if (action === "delete" || action === "rm") {
      app.getSession(id);
      app.deleteSession(id);
      process.stdout.write(`Deleted session ${id}.\n`);
      return;
    }

    if (action === "show") {
      const session = app.getSession(id);
      const messages = app.db.listMessages(id);
      process.stdout.write(`${paint.bold(session.title)} ${paint.dim(session.id)}\n${session.cwd}\n\n`);
      for (const message of messages) {
        process.stdout.write(`${paint.cyan(message.role)}: ${message.content.slice(0, 400)}\n`);
      }
      return;
    }

    throw new FluxError("config", `Unknown sessions action: ${action}. Try list, show, delete.`);
  } finally {
    app.close();
  }
}
