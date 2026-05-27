# Cairn

Local-only personal finance tracker for households. Standalone Tauri desktop app with local SQLite storage.

## Disclaimer

This is a personal project distributed under the MIT License (see
[LICENSE](LICENSE)). It is **not financial, investment, tax, legal,
or accounting advice**. Calculations, projections, and recommendations
are generated mechanically from the data you enter and from public
reference data; they may be incomplete, outdated, or wrong. **You are
solely responsible for verifying anything before acting on it**, and
should consult a qualified professional for decisions that materially
affect your finances.

The app stores all data locally on your device. The author cannot
recover lost data or restore a corrupted database. Use of this app is
**at your own risk**, with no warranty of any kind to the maximum
extent permitted by law.

This software is not affiliated with, endorsed by, or sponsored by
Yahoo, Yahoo Finance, or any other third party whose data or APIs
it may access. Tax reference data is **U.S.-only** and reflects the
author's best effort at the time of publication; tax law changes
frequently.

## Install

The app is distributed as an unsigned zipped `.app` bundle (Apple Silicon
Macs). No App Store, no installer — just download, unzip, drag, and open.

> **Why `.app.zip` and not `.dmg`?** `bundle_dmg.sh` (Tauri's DMG bundler)
> fails on macOS 26 because its AppleScript-driven Finder window positioning
> step needs Automation permissions that don't exist in a headless build
> context. The zipped `.app` flow ships the same binary without the broken
> intermediate step. We can revisit `.dmg` once Tauri or macOS resolves the
> `bundle_dmg.sh` issue.

**Download the latest build:**
<https://github.com/raymondgochuico/cairn/releases/latest>

Grab the file named `Cairn_<version>_aarch64.app.zip`.

**Then:**

1. Double-click the downloaded `.app.zip` to unzip it. macOS produces
   `Cairn.app` in the same folder.
2. Drag `Cairn.app` into the `Applications` folder.
3. **First time only — right-click `Cairn.app` in `Applications`, choose
   "Open", then click "Open" again in the dialog that appears.** macOS
   remembers the approval, so every launch after the first one is a normal
   double-click.
4. *Alternative* (Terminal one-liner that skips step 3 entirely):

   ```bash
   xattr -d com.apple.quarantine /Applications/Cairn.app
   ```

### Why the security warning?

Cairn is distributed **unsigned** because it's a personal-finance side
project, not commercial software — paying $99/yr for an Apple Developer
account just so a handful of friends can install it isn't worth it. macOS
shows a one-time scary "unidentified developer" dialog the first time you
open any unsigned app from outside the App Store. After approving once, the
dialog never appears again. The app itself is the same code you can read in
this repo; nothing is hidden by the signing absence.

If/when Cairn ever scales beyond friends, the build process is set up to
add code signing in one line — see `src-tauri/SIGNING.md`.

## Status

Phase 5 / Sprint 4 in flight — A-grade v1 ship target close. All v1 feature
work is shipped (tracking, calculators, What-If, spending, budget, roadmap,
disclosures, equity grants, monthly mini-window). Sprint 4 is closing the
last-mile gaps (`.app.zip` build, manual updater wiring, dark-mode chart
adapt, finance UI inputs for cap gains, virtualization, lazy routes) ahead
of the Wave-4 cohesion review and the first GitHub Release.

The app supports **light + dark** via system theme (Settings → Appearance).

For the full picture:

- [`docs/superpowers/specs/2026-05-27-current-state.md`](docs/superpowers/specs/2026-05-27-current-state.md) — cross-cutting snapshot, **read this first**.
- [`docs/reviews/2026-05-27-wave3-scorecard.md`](docs/reviews/2026-05-27-wave3-scorecard.md) — the 9-day A-grade roadmap.
- [`docs/superpowers/specs/2026-05-11-finance-app-design.md`](docs/superpowers/specs/2026-05-11-finance-app-design.md) — master design spec (build phases + current status amendment).
- [`docs/superpowers/conventions.md`](docs/superpowers/conventions.md) — engineering patterns.
- [`docs/superpowers/plans/`](docs/superpowers/plans/) — per-feature plans.

## Development

```bash
# install dependencies
npm install

# install the pre-commit hook (one-time per checkout / worktree)
npm run install-hooks

# run in dev mode (opens a native window)
npm run tauri dev

# run unit tests
npm test
```

### Pre-commit hook

`npm run install-hooks` copies `scripts/hooks/pre-commit` into the
repo's git hooks directory. The hook runs `vitest` + `npx tsc --noEmit`
before letting a commit land, so the recharts animation-policy test
(and the rest of the suite) gates every commit.

The hook has two modes:

| Mode                | Command                                  | Runtime  | When                                                          |
| ------------------- | ---------------------------------------- | -------- | ------------------------------------------------------------- |
| Fast lane (default) | `vitest run --changed --passWithNoTests` | 2–10 s   | Every `git commit`. Runs only tests affected by staged files. |
| Full                | `vitest run` (no `--bail`)               | 45–200 s | `SKIP_PRE_COMMIT=full git commit -m "…"` (e.g. pre-tag push). |

CI (`.github/workflows/test.yml`) runs the full suite on every push +
PR, so the fast lane at commit time is safe — anything the changed-files
heuristic misses is caught before merge. `--bail=1` was dropped so a
single flake no longer hides other (real) regressions from the developer.

Escape hatches when you need to land a WIP commit:

```bash
git commit --no-verify -m "WIP"           # one-off skip
SKIP_PRE_COMMIT=1 git commit -m "..."     # env-level skip (same effect)
SKIP_PRE_COMMIT=full git commit -m "..."  # opt into the full suite locally
```

The hook is repo-tracked at `scripts/hooks/pre-commit` — edit there and
re-run `npm run install-hooks` to refresh the installed copy. Worktrees
share the same hooks dir as the main checkout, so installing once is
enough.

## Tech stack

- Tauri 2.x (Rust shell, macOS-first; Windows wired but not the primary ship target)
- React 19 + TypeScript + Vite 7
- Tailwind CSS v3 + shadcn/ui (slate base, New York style)
- Radix UI primitives (Dialog, Popover) + lucide-react icons + next-themes (light / dark / system)
- Recharts (charting; animation explicitly disabled via repo-tracked policy test)
- SQLite (via `@tauri-apps/plugin-sql` in production; `better-sqlite3` in tests). Browser-mode shim under `src/lib/browser-shims/` (env-gated via `VITE_BROWSER_SHIM=1`) backs `npm run dev:browser` for preview-tool review.
- Zustand 5 (state) + Zod 4 (validation) + React Hook Form
- Vitest + React Testing Library; repo-tracked pre-commit hook gates every commit on `vitest run` + `tsc --noEmit`
- Custom Yahoo Finance client routed through `@tauri-apps/plugin-http` (no API key; avoids browser CORS)
