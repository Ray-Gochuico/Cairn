/**
 * Platform detection for COPY decisions only (distribution plan A3, F1).
 *
 * `isWindows()` is a deliberate user-agent sniff — NOT a Tauri API probe
 * (`@tauri-apps/plugin-os` is not a dependency, and a `__TAURI_INTERNALS__`
 * probe would couple this to the bridge being ready). Keeping this file free
 * of Tauri imports means:
 *
 *   - it is safe to import from boot-time paths (`src/db/boot-error-screen.ts`
 *     renders before the React tree and must stay free of static Tauri deps);
 *   - it trivially satisfies the UpdaterSection architectural guard test,
 *     which bans the updater plugin import outside UpdaterSection.tsx (that
 *     guard greps raw file contents, so even naming the package here in a
 *     comment would trip it);
 *   - it works identically in the `dev:browser` shim preview.
 *
 * Why the sniff is sound here: WebView2's user agent always contains
 * "Windows NT"; macOS WKWebView's user agent never contains "Windows"; and
 * `tauri.conf.json` sets no UA override. The worst case of a misdetection is
 * mislabeled copy ("Finder" vs "File Explorer") — never broken behavior.
 */
export function isWindows(): boolean {
  return typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent);
}
