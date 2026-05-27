export async function invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
  console.warn('[browser-shim/api/core] invoke not available in browser mode:', command, args);
  if (command === 'yahoo_quote_summary') {
    return JSON.stringify({ quoteSummary: { result: [] } }) as unknown as T;
  }
  throw new Error(`Tauri command "${command}" not available in browser mode`);
}

export const core = { invoke };

/**
 * Browser-shim stand-ins for the `Resource` and `Channel` classes the real
 * `@tauri-apps/api/core` exports. Tauri plugins (notably `plugin-updater`)
 * import these to model rust-backed resources and IPC channels — under
 * `npm run dev:browser` neither runtime exists, so we ship inert classes
 * with the same surface area as the upstream types so Vite's optimizeDeps
 * pass and the lazy chunks resolve without throwing on import.
 *
 * Both are intentionally no-ops: any callsite that actually needs a Tauri
 * resource will still fail (loudly) when it tries to use the rid/channel —
 * but the *module-level* import that was blowing up the Settings page chunk
 * now succeeds. Matches the upstream signatures verified against
 * `node_modules/@tauri-apps/api/core.d.ts`.
 */
export class Resource {
  // The upstream class stores a private rid; the public getter returns it.
  // We expose a fixed 0 so any consumer that reads it gets a deterministic
  // (and obviously-fake) value.
  get rid(): number {
    return 0;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_rid?: number) {
    // No-op: in the browser shim we have nothing to anchor against.
  }
  async close(): Promise<void> {
    // No-op: there is no rust resource to drop.
  }
}

export class Channel<T = unknown> {
  id = 0;
  onmessage: ((response: T) => void) | null = null;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(onmessage?: (response: T) => void) {
    if (onmessage !== undefined) this.onmessage = onmessage;
  }
  toJSON(): string {
    return '__TAURI_CHANNEL__';
  }
}
