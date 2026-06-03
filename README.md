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

The app is distributed as an unsigned, gzip-tarred `.app` bundle (Apple
Silicon Macs). No App Store, no installer — just download, unarchive,
drag, and open.

> **Why `.app.tar.gz` (and not `.dmg` or `.app.zip`)?** Two reasons.
> First, `bundle_dmg.sh` (Tauri's DMG bundler) fails on macOS 26 — its
> AppleScript-driven Finder window positioning step needs Automation
> permissions that don't exist in a headless build context, so there's
> no `.dmg`. Second, the in-app updater requires gzip+tar: the Tauri 2
> macOS updater unpacks the archive with `GzDecoder` + `tar` and has no
> `.zip` support (that's Windows-only), so a `.zip` would pass the
> signature check and then fail to install. Shipping the same
> `.app.tar.gz` for both manual download and the updater keeps one
> artifact. macOS Archive Utility unarchives `.tar.gz` on double-click,
> same as a `.zip`.

**Download the latest build:**
<https://github.com/raymondgochuico/cairn/releases/latest>

Grab the file named `Cairn_<version>_aarch64.app.tar.gz`.

**Then:**

1. Double-click the downloaded `.app.tar.gz` to unarchive it. macOS
   produces `Cairn.app` in the same folder.
2. Drag `Cairn.app` into the `Applications` folder.
3. **First time only — right-click `Cairn.app` in `Applications`, choose
   "Open", then click "Open" again in the dialog that appears.** This is the
   recommended way in: it clears Gatekeeper while leaving macOS's
   quarantine/tamper check intact (the OS still verifies the bundle hasn't
   been altered since download, and your click records consent). macOS
   remembers the approval, so every launch after the first one is a normal
   double-click.

> **Advanced — only if you trust the source.** You *can* clear Gatekeeper
> from Terminal instead:
>
> ```bash
> xattr -d com.apple.quarantine /Applications/Cairn.app
> ```
>
> Don't reach for this by default. It strips the quarantine flag outright,
> which **removes macOS's tamper check** on this unsigned download — the OS
> will no longer verify the bundle is the one you fetched. Only run it if you
> downloaded the release yourself from the official link above and trust it.
> The right-click → Open flow in step 3 is safer and just as permanent.

### Why the security warning?

Cairn is distributed **unsigned** because it's a personal-finance side
project, not commercial software — paying $99/yr for an Apple Developer
account just so a handful of friends can install it isn't worth it. macOS
shows a one-time scary "unidentified developer" dialog the first time you
open any unsigned app from outside the App Store. After approving once, the
dialog never appears again. The app itself is the same code you can read in
this repo; nothing is hidden by the signing absence.

If/when Cairn ever scales beyond friends, code signing is a multi-step
project, not a one-liner: enroll in the Apple Developer Program ($99/yr),
issue a Developer ID Application certificate, set `signingIdentity` in
`tauri.conf.json`, then notarize and staple the build. The steps are
listed in `src-tauri/SIGNING.md`.

## Privacy

Cairn is built around a strict "100% local" guarantee. **Your financial
data never leaves your device unless you explicitly export a CSV.** No
account, no sync, no telemetry, no crash reporter, no analytics SDK.

This section spells out the three concrete facts that back the
guarantee, so you can verify it for yourself. The same content is
mirrored inside the app at **Settings → Privacy & data**.

### Where your data lives

Everything Cairn knows — your accounts, transactions, settings, and
price cache — lives in a single SQLite file on this Mac at:

```
~/Library/Application Support/com.raymondgochuico.cairn/finance.db
```

The parent directory's permissions are `drwx------` (owner-only), so
no other macOS user on the same machine can read it. Settings →
Privacy & data has a **Show in Finder** button that opens the folder
for you.

### What network calls happen

Exactly two outbound calls, both user-controlled:

1. **Yahoo Finance refresh** — fetches current quotes for the tickers
   in your portfolio. Cadence is configurable on Settings → Market
   data (every launch / daily / weekly / **manual**). Pick *manual*
   to disable automatic refreshes; the *Refresh now* button still
   works on demand. The request body contains only the ticker
   symbols you have entered — no PII, no identifiers.
2. **Updater check** — fetches `latest.json` from the GitHub Releases
   page to compare against your installed version. **Only fires when
   you click "Check for updates"** in Settings → Updates — never on
   launch, never in the background.

Launch Cairn with Wi-Fi off and every feature except those two
opt-in calls still works.

### Encryption at rest

Cairn does not currently implement its own SQLite encryption (that's
on the v1.1 roadmap). macOS file-mode permissions protect the file
from other users on the same machine, but a thief who pulls the disk
out of an unlocked Mac could read the data in plaintext.

The recommended safeguard is **macOS FileVault**, which encrypts the
entire disk with your login password:

> *System Settings → Privacy & Security → FileVault*

FileVault is on by default for new Macs since macOS 11, but is **not**
retroactively enabled on machines that were upgraded from earlier
versions. If you imported a transaction history with sensitive
balances, take 30 seconds to verify FileVault is on.

## Status

**v1.0.0 — shippable.** All feature work plus the full v1.0 distribution-readiness
remediation are complete: all 7 ship-blockers and the High set are fixed, whole-database
backup + restore are verified on real hardware, and the suite is green (4295 vitest +
17 cargo tests, `tsc` clean). Overall ship-readiness **A−**. Shipping is gated only on
tagging `v1.0.0` (and a first in-app updater round-trip once a `v1.0.1` exists).

The app supports **light + dark** via system theme (Settings → Appearance).

For the full picture:

- [`docs/superpowers/specs/2026-06-03-current-state.md`](docs/superpowers/specs/2026-06-03-current-state.md) — post-remediation cross-cutting snapshot, **read this first**.
- [`docs/superpowers/specs/2026-06-03-roadmap.md`](docs/superpowers/specs/2026-06-03-roadmap.md) — what's next (ship steps + the v1.0.x / v1.1+ / v2 backlog).
- [`docs/reviews/2026-06-02-distribution-readiness-scorecard.md`](docs/reviews/2026-06-02-distribution-readiness-scorecard.md) — the 10-domain distribution-readiness panel + the wave-by-wave re-grades + dogfood verification.
- [`docs/superpowers/specs/2026-05-11-finance-app-design.md`](docs/superpowers/specs/2026-05-11-finance-app-design.md) — master design spec (build phases).
- [`docs/superpowers/conventions.md`](docs/superpowers/conventions.md) — engineering patterns.
- [`docs/superpowers/plans/`](docs/superpowers/plans/) — per-feature plans.

### Market data freshness

Every market-dependent value in the app (portfolio totals, net worth,
What-If projections, equity-grant FMV, concentration breakdown) carries
a small "Updated *X* ago" pill so you always know how recent the
underlying prices are. The pill turns amber with an alert icon when the
data has aged past 1.5× your configured refresh cadence — by default,
36 hours for the daily cadence or 10.5 days for the weekly cadence.
Hover the pill to see the exact timestamp, plus a one-click *Refresh
now* action.

The refresh cadence (every launch / daily / weekly / manual) is set on
**Settings → Market data**. *Manual* disables the staleness warning
entirely — opt out and the pill still surfaces the timestamp, but
never nags. The "Refresh now" button there triggers an immediate price
refresh from Yahoo Finance regardless of the chosen cadence.

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
