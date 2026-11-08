// Atomic JSON persistence for small, durable FLUX records.
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export class LocalJsonStore<T> {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string, private readonly empty: T) {}

  async read(): Promise<T> {
    try {
      return JSON.parse(await readFile(this.filePath, "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return this.empty;
      throw error;
    }
  }

  write(value: T): Promise<void> {
    return this.enqueue(() => this.writeFileAtomically(value));
  }

  update(updater: (current: T) => T | Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      const current = await this.read();
      const updated = await updater(current);
      await this.writeFileAtomically(updated);
      return updated;
    });
  }

  private async writeFileAtomically(value: T): Promise<void> {
    const directory = dirname(this.filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") await chmod(directory, 0o700);
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", flag: "wx", mode: 0o600 });
    if (process.platform !== "win32") await chmod(temporary, 0o600);
    await rename(temporary, this.filePath);
  }

  private enqueue<R>(operation: () => Promise<R>): Promise<R> {
    const result = this.writeQueue.then(operation);
    this.writeQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}

export function defaultDataDirectory(): string {
  return process.env.FLUX_DATA_DIR ?? join(process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? ".", "AppData", "Local"), "FLUX");
}
