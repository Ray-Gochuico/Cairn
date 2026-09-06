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

## Dev caches, the dev stamp, and the e2e knobs (v1.7.0 W-I)

- **Dep cache per role, per tree.** Vite optimizes dependencies into
  `<tree>/.vite.local/<role>/` (`tauri` | `browser` | `seed` | `fresh`;
  `CAIRN_DEV_ROLE` overrides the role derived from `VITE_BROWSER_SHIM` /
  `VITE_SEED_DEMO`). The folder rides `.gitignore`'s `*.local` rule. A worktree
  with a symlinked `node_modules` no longer shares `node_modules/.vite/deps`
  with the main checkout, and the two Playwright servers no longer race each
  other's cold optimize. The first start of a role in a tree pays one cold
  optimize; `rm -rf .vite.local` resets.
- **Dev stamp.** Every dev server answers `GET /__cairn/dev-stamp` with
  `{ root, role, port, seed, nonce, pid, head, cacheDir }` (a serve-only plugin;
  absent from `vite build`). `curl -s localhost:1422/__cairn/dev-stamp` tells you
  which tree a port is serving.
- **Playwright never attaches silently.** `reuseExistingServer` is off by
  default; a busy 1422/1423 fails at once with Playwright's "is already used"
  error. `PW_REUSE_SERVER=1` attaches to a server you started yourself —
  `e2e/global-setup.ts` still refuses a server from another tree or of the
  wrong role.
- **Load policy.** At or above `0.7 × cores` 1-min load the suite runs
  serialized with a 120 s test timeout and says so; at or above `1.5 × cores`
  (local only) it refuses to run. `E2E_LOAD_SOFT`, `E2E_LOAD_HARD`,
  `E2E_LOAD_GUARD=0`. The last log line names timeouts apart from failures with
  the load at start and end; the exit code is never changed by it.
