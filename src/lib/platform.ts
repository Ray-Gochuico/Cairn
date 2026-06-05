/**
 * Host-platform detection for cross-platform in-app copy.
 *
 * We deliberately sniff the WebView user-agent string rather than reach for
 * `@tauri-apps/plugin-os` (which is NOT a dependency) or probe
 * `__TAURI_INTERNALS__`. On Windows the WebView2 user-agent always carries
 * "Windows NT"; macOS WKWebView never does, and our Tauri config sets no UA
 * override. A misdetection only mislabels descriptive copy (Finder vs File
 * Explorer, FileVault vs BitLocker, the data-path placeholder) — it never
 * gates behavior or a network call — so a cheap, pure string test is the
 * right tool here.
 *
 * Pure + side-effect-free so any surface can call it inline during render.
 */
export function isWindows(): boolean {
  return typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent);
}
