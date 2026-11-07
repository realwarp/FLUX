import { FluxError } from "@flux/shared";

/**
 * Resolves credential *references* into secret values only at request time.
 * FLUX never stores plaintext keys in config, SQLite, transcripts or logs.
 *
 * Supported references:
 *   env:VARIABLE_NAME   — read at request time
 *   (absent)            — endpoint requires no credential (typical local gateway)
 */
export class CredentialResolver {
  constructor(private readonly env: Record<string, string | undefined> = process.env) {}

  resolve(ref: string | undefined): string | undefined {
    if (!ref) return undefined;
    if (ref.startsWith("env:")) {
      const name = ref.slice(4);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        throw new FluxError("config", `Invalid credential reference variable: ${name}`);
      }
      const value = this.env[name];
      if (!value) {
        throw new FluxError(
          "provider-auth",
          `Environment variable ${name} is not set. Set it or reconfigure the provider profile.`,
        );
      }
      return value;
    }
    throw new FluxError("config", `Unsupported credential reference. Use env:VARIABLE_NAME.`);
  }

  /** Non-secret description used by doctor/TUI. */
  describe(ref: string | undefined): string {
    if (!ref) return "none (no credential)";
    return ref;
  }

  isResolvable(ref: string | undefined): boolean {
    if (!ref) return true;
    if (!ref.startsWith("env:")) return false;
    return Boolean(this.env[ref.slice(4)]);
  }
}
