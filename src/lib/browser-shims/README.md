# Browser-mode shims

These modules let the React app run in a regular browser (`npm run dev:browser`)
for review/QA purposes — no Tauri runtime required.

Activated by Vite when `VITE_BROWSER_SHIM=1`; `vite.config.ts` swaps each
`@tauri-apps/*` import for the matching shim here. The Tauri production build
sets no env var and is untouched.

## Coverage

| Plugin | Shim | Notes |
|---|---|---|
| `@tauri-apps/plugin-sql` | `plugin-sql.ts` | sql.js (SQLite-WASM) in-memory; persists to IndexedDB across reloads. |
| `@tauri-apps/api/core` | `api-core.ts` | `invoke()` returns rejected promise for unknown commands; logs to console. |
| `@tauri-apps/plugin-fs` | `plugin-fs.ts` | `writeFile`/`readDir`/`exists` are no-ops that warn once. |
| `@tauri-apps/plugin-dialog` | `plugin-dialog.ts` | `open()` returns a fake path string for directory picks; `save` returns a synthetic path. |
| `@tauri-apps/plugin-notification` | `plugin-notification.ts` | Web Notifications API. |
| `@tauri-apps/plugin-http` | `plugin-http.ts` | Pass-through to native `fetch` (subject to CORS — Yahoo calls will fail). |
| `@tauri-apps/plugin-opener` | `plugin-opener.ts` | `openUrl` → `window.open`. |

## Limitations vs. real Tauri

- **Yahoo refresh fails** in browser mode (CORS). The app boots fine; background
  refresh errors are swallowed by existing code.
- **Statements archive** can't write to a real folder. Picker returns a stub path.
- **CSRF crumb auth** for Yahoo `quoteSummary` requires the Rust client. Browser
  shim returns an empty result for those calls.

These are acceptable for review: teammates can navigate the UI, exercise CRUD,
edit forms, switch tabs. They cannot exercise real network refresh or filesystem
archive paths.
