# Cairn

Local-only personal finance tracker for households. Standalone Tauri desktop
app with local SQLite storage. **All data stays on your device** — no account,
no sync, no telemetry (see [Privacy](#privacy)).

> **Not financial advice.** Cairn is a personal MIT-licensed project;
> verify anything before acting on it. Full terms in the
> [Disclaimer](#disclaimer).

## Install

Installing Cairn takes about two minutes: **download one file, open it,
and approve a one-time security prompt.** The prompt appears because
Cairn is a free personal project that isn't registered with Apple or
Microsoft, so your computer double-checks with you once —
[more on that below](#why-the-one-time-security-warning).

**Step 1 — click the download link for your computer:**

| Your computer | Click to download |
| --- | --- |
| **Mac** — any Mac (Apple Silicon or Intel) | **[⬇ Download Cairn for Mac](https://github.com/Ray-Gochuico/Cairn/releases/latest/download/Cairn-macOS.app.tar.gz)** (~20 MB) |
| **Windows** — Windows 10 or 11 (64-bit) | **[⬇ Download Cairn for Windows](https://github.com/Ray-Gochuico/Cairn/releases/latest/download/Cairn-Windows-Setup.exe)** (~7 MB) |

The file saves to your **Downloads** folder (your browser may also show
it in a bar or a downloads icon near the top of the window). If Safari
asks *"Do you want to allow downloads on github.com?"*, click **Allow**.
No account or sign-in is needed, and the links always fetch the newest
version — they point at the same files listed on the
[Releases page](https://github.com/Ray-Gochuico/Cairn/releases/latest).

**Step 2 — follow the steps for your computer below.**

### Mac — after the download

1. **Open your Downloads folder.** Click the blue-and-white smiley face
   (**Finder**) at the left end of the Dock, then choose **Go →
   Downloads** from the menu at the very top of the screen — or click
   the **Downloads** stack near the right end of the Dock.
2. **Unpack the file.** Double-click `Cairn-macOS.app.tar.gz`. After a
   moment, an app named **Cairn** appears in the same folder.

   *Already see **Cairn** there without doing anything? Safari often
   unpacks downloads automatically — just continue to step 3. If you
   instead see a file ending in **.tar**, double-click that one too.*
3. **Put it in Applications.** Drag **Cairn** onto **Applications** in
   the Finder sidebar. (No sidebar? Open a second window with **File →
   New Window**, choose **Go → Applications** in it, and drag Cairn from
   Downloads into that window.) That's all "installing" is on a Mac.
4. **Open it the special way — first time only.** In the Applications
   folder, hold the **Control** key and click **Cairn** (or right-click
   it), choose **Open** from the little menu, then click **Open** again
   when macOS warns that it can't verify the developer. Cairn's window
   opens — you're done. macOS remembers your answer, so from now on you
   open Cairn like any other app (double-click it, or find it with
   Spotlight).

   **Don't see an "Open" button in the warning?** Newer versions of
   macOS hide it. Close the warning, open **System Settings** (Apple
   menu, top-left corner of the screen → System Settings), click
   **Privacy & Security**, scroll down until you see the message that
   Cairn was blocked, click **"Open Anyway"**, and — when your Mac asks —
   type your normal login password or use Touch ID. That's expected, and
   you only ever do it once.

**Updating on a Mac:** inside the app, go to **Settings → Updates →
Check for updates**. Cairn downloads and installs the new version for
you — no need to repeat any of the steps above.

### Windows — after the download

1. **Run the installer.** Open **File Explorer** (the yellow folder icon
   in the taskbar), click **Downloads** on the left, and double-click
   **Cairn-Windows-Setup** (your browser may also let you click it right
   in its downloads bar).

   *Did your browser say the file "was blocked" or "can't be downloaded
   securely"? That's the same one-time check described below, applied at
   download time. In Edge: hover over the file in the downloads list,
   click the **⋯** (three dots) → **Keep**, then **Show more → Keep
   anyway**.*
2. **Get past the blue screen.** Windows shows a blue **"Windows
   protected your PC"** message because the installer isn't registered
   with Microsoft. Click the small **"More info"** link on that screen,
   then the **"Run anyway"** button that appears. You'll only see this
   once.
3. **Click through the installer** and accept the suggestions it makes.
   If it offers to install the **WebView2 runtime**, say yes — Cairn
   needs it (most PCs already have it, so you may not even be asked).
4. **Open Cairn**: press the **Windows key**, type **Cairn**, and press
   Enter — like any other program.

**Updating on Windows:** there's no in-app updater on Windows yet — when
a new version comes out, click the
[Windows download link](https://github.com/Ray-Gochuico/Cairn/releases/latest/download/Cairn-Windows-Setup.exe)
again and run it; it updates your existing install in place. If you have
a (free) GitHub account, click **Watch → Custom → Releases** at the top
of this page to get an email only when a new version ships.

### Opening Cairn after installation

The one-time security steps above never repeat — from now on Cairn opens
like any other app:

- **Mac:** press **Cmd+Space**, type **Cairn**, and press Enter (that's
  Spotlight — the fastest way), or double-click **Cairn** in the
  Applications folder.
- **Windows:** press the **Windows key**, type **Cairn**, and press
  Enter, or find it in the Start menu's app list.

There's no account and nothing to sign in to. The very first time Cairn
opens it walks you through a short setup (and shows the disclaimer);
every time after that, it opens straight into your numbers, loaded from
the database file on your computer — see [Privacy](#privacy) for exactly
where that file lives.

### Put Cairn in the bar at the bottom of your screen (optional)

If you'll use Cairn regularly, park it in the bar at the bottom of the
screen so it's always one click away.

**Mac — add Cairn to the Dock:**

1. Open the **Applications** folder: click the **Finder** smiley face at
   the left end of the Dock, then choose **Go → Applications** from the
   menu at the top of the screen.
2. **Drag the Cairn icon down into the Dock** — anywhere among the other
   app icons, to the **left of the thin divider line** near the Trash.
   The other icons slide apart to make room; let go, and Cairn stays
   there permanently.
3. From now on, one click on that icon opens Cairn.

*Shortcut if Cairn is already open:* its icon is already sitting in the
Dock — hold **Control** and click it (or click with two fingers on a
trackpad), then choose **Options → Keep in Dock**.

*Changed your mind?* Drag the icon upward out of the Dock until
**Remove** appears, then let go. This only removes the shortcut — the
app stays installed in Applications.

**Windows — pin Cairn to the taskbar:**

1. Press the **Windows key** and type **Cairn**.
2. **Right-click** the Cairn search result and choose **Pin to
   taskbar**. (You can also choose **Pin to Start** to add a tile to the
   Start menu.)
3. From now on, one click on the taskbar icon opens Cairn.

*Shortcut if Cairn is already open:* right-click its icon in the taskbar
and choose **Pin to taskbar**.

*Changed your mind?* Right-click the taskbar icon and choose **Unpin
from taskbar**. The app stays installed.

### If something doesn't look right

<details>
<summary><strong>I can't find the download.</strong></summary>

Look in the **Downloads** folder (Finder → Go → Downloads on a Mac;
File Explorer → Downloads on Windows). In most browsers **Ctrl+J**
(Windows) or **Cmd+Option+L** (Mac, Chrome) opens the download list.

</details>

<details>
<summary><strong>I ended up with a folder of code, not an app.</strong></summary>

You probably clicked one of the **"Source code"** links on the Releases
page — those are for programmers. Use the two download links at the top
of this section instead.

</details>

<details>
<summary><strong>Mac: double-clicking the <code>.tar.gz</code> does nothing.</strong></summary>

Right-click the file → **Open With** → **Archive Utility**. Cairn will
appear in the same folder.

</details>

<details>
<summary><strong>Mac: it says Cairn "is damaged and can't be opened."</strong></summary>

Despite the wording, this is usually the security check in disguise, not
a broken file — use **System Settings → Privacy & Security → "Open
Anyway"** (see Mac step 4). If that entry isn't there, move Cairn to the
Trash, download it again from the link above, and repeat the steps.

</details>

<details>
<summary><strong>Mac (advanced): clearing Gatekeeper from Terminal — not recommended.</strong></summary>

```bash
xattr -d com.apple.quarantine /Applications/Cairn.app
```

Don't reach for this by default. It strips the quarantine flag outright,
which **removes macOS's tamper check** on this unsigned download — the OS
will no longer verify the bundle is the one you fetched. Only run it if you
downloaded the release yourself from the official link above and trust it.
The Control-click → Open flow in Mac step 4 is safer and just as permanent.

</details>

<details>
<summary><strong>Why a <code>.tar.gz</code> and not a <code>.dmg</code>? (for the curious)</strong></summary>

Two reasons. Tauri's DMG bundler fails on macOS 26 (its AppleScript-driven
Finder step needs Automation permissions that don't exist in a headless
build), so there's no `.dmg`. And the Tauri 2 macOS in-app updater can only
unpack gzip+tar (`.zip` support is Windows-only), so shipping the same
`.app.tar.gz` for both manual download and the updater keeps one artifact.
macOS unarchives `.tar.gz` on double-click, same as a `.zip`.

</details>

### Why the one-time security warning?

Cairn is distributed **unsigned** because it's a personal-finance side
project, not commercial software. macOS shows a one-time "unidentified
developer" dialog; Windows shows a one-time SmartScreen prompt. After
approving once, neither warning appears again. The app itself is the same
code you can read in this repo; nothing is hidden by the signing absence.

<details>
<summary>What signing would take, if Cairn ever scales beyond friends</summary>

Code signing is a multi-step project, not a one-liner: enroll in the Apple
Developer Program ($99/yr), issue a Developer ID Application certificate,
set `signingIdentity` in `tauri.conf.json`, then notarize and staple the
build. Windows code-signing (e.g. Azure Trusted Signing) is a separate
future option. The steps are listed in `src-tauri/SIGNING.md`.

</details>

## Privacy

Cairn is built around a strict "100% local" guarantee. **Your financial
data never leaves your device unless you explicitly export a CSV.** No
account, no sync, no telemetry, no crash reporter, no analytics SDK.

This section spells out the three concrete facts that back the
guarantee, so you can verify it for yourself. The same content is
mirrored inside the app at **Settings → Privacy & data**.

### Where your data lives

Everything Cairn knows — your accounts, transactions, settings, and
price cache — lives in a single SQLite file on your device.

**macOS:**

```
~/Library/Application Support/com.raymondgochuico.cairn/finance.db
```

The parent directory's permissions are `drwx------` (owner-only), so
no other macOS user on the same machine can read it. Settings →
Privacy & data has a **Show in Finder** button that opens the folder
for you.

**Windows:**

```
%APPDATA%\com.raymondgochuico.cairn\finance.db
```

(`%APPDATA%` expands to `C:\Users\<you>\AppData\Roaming` on a typical
install.) You can paste the path directly into File Explorer's address
bar to open the folder.

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
on the v1.1 roadmap). OS-level file permissions protect the file from
other users on the same machine, but a thief who pulls the disk out of
an unlocked device could read the data in plaintext.

The recommended safeguard is full-disk encryption, which encrypts the
entire disk with your login credentials:

**macOS — FileVault:**

> *System Settings → Privacy & Security → FileVault*

FileVault is on by default for new Macs since macOS 11, but is **not**
retroactively enabled on machines that were upgraded from earlier
versions. If you imported a transaction history with sensitive
balances, take 30 seconds to verify FileVault is on.

**Windows — BitLocker / Device encryption:**

> *Settings → Privacy & security → Device encryption*
> (or search "BitLocker" in Start for the full BitLocker management panel)

Device encryption is on by default on modern Windows 11 hardware signed
in with a Microsoft account. BitLocker (available on Windows 10/11 Pro)
provides the same protection with more management options. Verify it is
enabled if you store sensitive financial data on the machine.

## Status

Cairn is released and under active development — the installable build is
always the [latest release](https://github.com/Ray-Gochuico/Cairn/releases/latest).
Every commit is gated by a ~5,700-test suite (vitest + cargo, `tsc` clean)
via a repo-tracked pre-commit hook and CI.

The app supports **light + dark** via system theme (Settings → Appearance).

Design notes, specs, and the full roadmap are kept in the maintainer's local working tree (not in this public repo).

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

## Feedback

Found a bug? Open an issue: <https://github.com/Ray-Gochuico/Cairn/issues>

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

- Tauri 2.x (Rust shell, macOS universal — Apple Silicon + Intel — and Windows x64)
- React 19 + TypeScript + Vite 7
- Tailwind CSS v3 + shadcn/ui (slate base, New York style)
- Radix UI primitives (Dialog, Popover) + lucide-react icons + next-themes (light / dark / system)
- Recharts (charting; animation explicitly disabled via repo-tracked policy test)
- SQLite (via `@tauri-apps/plugin-sql` in production; `better-sqlite3` in tests). Browser-mode shim under `src/lib/browser-shims/` (env-gated via `VITE_BROWSER_SHIM=1`) backs `npm run dev:browser` for preview-tool review.
- Zustand 5 (state) + Zod 4 (validation) + React Hook Form
- Vitest + React Testing Library; repo-tracked pre-commit hook gates every commit on `vitest run` + `tsc --noEmit`
- Custom Yahoo Finance client routed through `@tauri-apps/plugin-http` (no API key; avoids browser CORS)
