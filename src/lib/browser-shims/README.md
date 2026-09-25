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
  optimize; `rm -rf .vite.local` resets. Vitest's own results cache (test
  ordering) lives under `<tree>/.vite.local/vitest/` too, so a worktree's
  `npm test` no longer rewrites the main checkout's
  `node_modules/.vite/vitest/`.
- **Dev stamp.** Every dev server answers `GET /__cairn/dev-stamp` with
  `{ root, role, port, seed, shim, nonce, pid, head, cacheDir }` (a serve-only
  plugin; absent from `vite build`). `curl -s localhost:1422/__cairn/dev-stamp`
  tells you which tree a port is serving.
- **Playwright never attaches silently.** `reuseExistingServer` is off by
  default; a busy 1422/1423 fails at once with Playwright's "is already used"
  error. `PW_REUSE_SERVER=1` attaches to a server you started yourself —
  `e2e/global-setup.ts` still refuses a server from another tree, of another
  role, or without the browser shim (the tree is compared as a path, not as a
  spelling: realpath, forward slashes, no trailing separator).
- **Two trees at once.** `E2E_PORT_BASE=<n>` moves the seed server to `<n>` and
  the fresh server to `<n>+1` — for `npm run dev:browser:seed` /
  `npm run dev:browser:fresh`, `npx playwright test` and the identity check
  alike (e.g. `E2E_PORT_BASE=1522 npx playwright test` in a worktree while the
  main checkout runs at the fixed 1422/1423). Unset, nothing moves. The tauri
  (1420) and browser (1421) roles never move; a value outside 1024–65534, or one
  whose pair lands on 1420/1421, fails at once rather than falling back. The
  port now follows the ROLE inside `vite.config.ts` (the two scripts pass no
  `--port`), so a seed- or fresh-role server started by hand without `--port`
  answers on 1422/1423; a `--port` on the command line still wins.
- **Load policy.** Above `0.7 × cores` 1-min load the suite runs serialized with
  a 120 s test timeout and says so; at or above `1.5 × cores` (local only) it
  refuses to run, once, with that one line. `E2E_LOAD_SOFT`, `E2E_LOAD_HARD`,
  `E2E_LOAD_GUARD=0`. The reading is taken once per run, in the main process,
  and every worker inherits it. After the run summary the reporter prints one
  line naming timeouts apart from failures with the load at start and end (the
  list reporter's failure detail follows it, so it is not the last line of the
  log); the exit code is never changed by it — `onEnd` returns nothing, and a
  test pins that it never returns a status. The specs' boot waits follow the
  policy: `bootTimeout()` (`e2e/boot-timeout.ts`) is half the test timeout —
  30 s under normal parallelism, 60 s serialized — read from the frozen policy
  in `test.info().config.metadata`; `tests/e2e-harness/spec-timeouts.test.ts`
  refuses a new numeric timeout literal in a spec.
- **Type-checking the harness.** `npx tsc -p tsconfig.node.json --noEmit` covers
  `vite.config.ts`, `playwright.config.ts`, `scripts/dev-servers.ts` and all of
  `e2e/`; the root `npx tsc --noEmit` still covers `src/` only. Its build info
  is written under `.vite.local/`, so the receipt leaves the tree clean.
