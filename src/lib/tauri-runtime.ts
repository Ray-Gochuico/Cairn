/**
 * Tauri runtime detection, isolated in a module with NO Tauri imports so it
 * is safe to import from anywhere — including boot paths and modules that
 * must also load in the `dev:browser` shim build (mirrors the boot-safe
 * pattern of src/lib/platform.ts).
 */

/**
 * True when running inside the Tauri webview (vs. `dev:browser`). We probe the
 * runtime marker Tauri injects rather than importing the SDK's `isTauri`,
 * because the browser shim for `@tauri-apps/api/core` does not re-export it —
 * importing it would break the browser build.
 */
export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
