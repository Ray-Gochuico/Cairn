# Changelog

All notable changes to Cairn are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-06-12

Cairn comes to Windows.

### Added

- **Windows (64-bit) support**: every release now ships a Windows installer
  (`Cairn_<version>_x64-setup.exe`) alongside the macOS app. Like the macOS
  build it is unsigned — Windows SmartScreen shows a one-time
  "More info → Run anyway" prompt on first run. The WebView2 runtime installs
  automatically if missing.
- Platform-aware in-app guidance: Settings → Privacy & data, Settings → Data,
  and the database-recovery screen now show the Windows data path,
  "File Explorer" labels, and BitLocker / device-encryption advice on Windows
  (FileVault/Finder remain on macOS).

### Changed

- On Windows, Settings → Updates explains that automatic updates aren't
  available there yet and links to the Releases page instead of showing a
  misleading "You're up to date".
- README install instructions are split into per-platform sections.

### Fixed

- Backup/restore and PDF statement archiving now build file paths with
  OS-correct separators, making both Windows-safe.

## [1.0.0] - 2026-06-04

First public release. Cairn is a local-only personal finance tracker for
households — a standalone macOS (Apple Silicon) desktop app with all data
stored in a single local SQLite file. No account, no sync, no telemetry.

### Added

- Local-first finance tracking: accounts, transactions, net worth, and a
  market-data-backed portfolio with per-value "Updated *X* ago" freshness pills.
- Planning tools: What-If projections, Coast-FI / sequential-drawdown
  modeling, paycheck and effective-tax-rate calculators (U.S. federal +
  state brackets, LTCG/NIIT), and equity-grant FMV.
- Light + dark themes following the system appearance.
- A learning section with a 600-question finance trivia bank.
- In-app legal disclosure and a Privacy & data panel mirroring the README's
  "100% local" guarantee.
- Whole-database backup and restore (Settings → Data): one-click consistent
  backups of your entire local database into a rotating folder, an in-app list
  to restore from any of them, and an atomic, corruption-safe restore — so your
  irreplaceable data survives a lost Mac or a damaged database.
- Guided onboarding: after the setup wizard, a "You're set up" → **Tailor** →
  **Tour** flow. *Tailor* switches off sidebar tabs and calculator cards that
  don't apply to the data you entered (e.g. no equity grants → no Equity Grants
  tab or Equity Value calculator), fully reversible; *Tour* is a skippable
  spotlight walkthrough of the tabs you kept, replayable any time from
  Settings → Getting started.
- Investments donut: a collapsible legend ("Show all (N) / Show less") for long
  legends such as per-company exposure.

### Changed

- Calculator-card visibility is now stored in the database (single source of
  truth, covered by backup/restore) instead of browser localStorage; the
  visibility editors (Settings → Sidebar, Calculators → manage) use toggle
  switches.

### Fixed

- Investments per-company donut: thin/small wedges no longer render colorless
  (a minimum-angle floor plus a 1px hairline stroke so every wedge keeps its
  fill).

### Distribution

- Ships as an **unsigned `Cairn.app`** (Apple Silicon) via GitHub Releases —
  no App Store, no installer, no Apple Developer enrollment. First launch
  uses the standard macOS right-click → Open Gatekeeper approval.
- **Manual-only auto-updater** (Settings → Updates): the app never polls in
  the background and makes no network calls unless you ask. Updates are
  delivered as a minisign-signed `.app.tar.gz` archive and verified against
  the public key embedded in the app before installation.
- Release pipeline (`.github/workflows/release.yml`) builds, signs, and
  publishes on a `v*` tag, gated behind the full JS + Rust test suite so a
  red build can never ship to auto-updating users.

### Privacy

- All financial data lives only on your device. The two outbound network
  calls (Yahoo Finance quote refresh and the updater check) are both
  user-controlled and contain no PII.

[1.0.1]: https://github.com/Ray-Gochuico/Cairn/releases/tag/v1.0.1
[1.0.0]: https://github.com/Ray-Gochuico/Cairn/releases/tag/v1.0.0
