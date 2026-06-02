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
| `@tauri-apps/plugin-fs` | `plugin-fs.ts` | `writeFile`/`readDir`/`exists`/`mkdir`/`remove` are no-ops that warn once (`readDir` returns `[]`). Backup rotation needs `mkdir`/`remove`, but those paths are gated behind `isTauriRuntime()` and never run in the browser. |
| `@tauri-apps/plugin-dialog` | `plugin-dialog.ts` | `open()` returns a fake path string for directory picks; `save` returns a synthetic path. |
| `@tauri-apps/plugin-notification` | `plugin-notification.ts` | Web Notifications API. |
| `@tauri-apps/plugin-http` | `plugin-http.ts` | Pass-through to native `fetch` (subject to CORS — Yahoo calls will fail). |
| `@tauri-apps/plugin-opener` | `plugin-opener.ts` | `openUrl` → `window.open`. |

## Limitations vs. real Tauri

- **Yahoo refresh fails** in browser mode (CORS). The app boots fine; background
  refresh errors are swallowed by existing code.
- **Populated-donut smoke:** because Yahoo is CORS-blocked, the Investments
  donuts render empty on a fresh DB. Use the dev-only seed (`npm run
  dev:browser:seed`, sets `VITE_SEED_DEMO=1`) or the manual runbook at
  `docs/runbooks/populated-donut-smoke.md` to populate them. The seed is
  triple-guarded (`DEV` + `VITE_BROWSER_SHIM` + `VITE_SEED_DEMO`) and never
  ships in prod.
- **Statements archive** can't write to a real folder. Picker returns a stub path.
- **CSRF crumb auth** for Yahoo `quoteSummary` requires the Rust client. Browser
  shim returns an empty result for those calls.

These are acceptable for review: teammates can navigate the UI, exercise CRUD,
edit forms, switch tabs. They cannot exercise real network refresh or filesystem
archive paths.
