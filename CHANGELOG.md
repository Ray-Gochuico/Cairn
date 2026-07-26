# Changelog

All notable changes to Cairn are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-07-20

The calculators grow up, the app finds its look, and a season of
correctness fixes lands. Your database upgrades automatically on first
launch.

### Added

- **Scenario bar on Calculators**: portfolio, contribution, expenses,
  return, withdrawal rate, and inflation now live in ONE bar shared by the
  planning calculators — edit once, every card recomputes, with per-field
  "edited" dots and one-click reset to your real data. Salaries are
  editable there too, rippling through the tax calculators without
  touching your saved Inputs.
- **Send to What-If**: turn the scenario you just sketched in the bar into
  a real What-If scenario with one click.
- **Debt payoff compares plans side-by-side**: Avalanche and Snowball
  columns are always computed, with the trade-off quantified in dollars
  and months.
- **Equity value is a real calculator now**: what-if the FMV and watch
  everything reprice, see the next-12-months vesting figure with a
  forward vesting chart, and a freshness stamp on each grant's price.
- **Backtest verdict on the card**: the last run's result (e.g. "98% of
  123 start years sustained this plan") persists on the calculator card,
  with all figures in today's dollars.
- **Per-person marginal tax view** on the Paycheck card for multi-earner
  households.
- **Next-dollar field**: set a monthly amount once in the "Next dollar"
  section header and the Debt and Allocator cards pick it up as their
  default.
- **Deep links**: `/calculators#<card>` opens that calculator directly;
  old card links redirect to their merged successors.

### Changed

- **The Calculators page is rebuilt.** Three calm sections — Paycheck &
  tax, Path to FI, Next dollar — of fixed-height summary cards, each
  opening (one at a time) into a full-width workbench with its inputs in
  a side rail. Twelve cards became ten: Bonus + Commission merged into
  **Supplemental pay**, Years-to-FI + CoastFI merged into **Path to FI**
  (with a keep-contributing / stop-today mode switch). Hidden-card
  preferences carry over automatically.
- **New visual identity** across the app: warm stone neutrals, Inter
  Tight headings, a single blaze accent, and quieter chrome, in both
  light and dark themes.
- **The Dashboard is a briefing**: what changed since last month and what
  needs your attention, up top.
- **Inputs became Setup**, and facts are now edited where they live —
  in-place edit drawers replace bouncing between pages.
- **Learn shows one question at a time** (four per day) with a persistent
  Basics / Going deeper / Mix difficulty toggle.

### Fixed

- **Money correctness sweep**, verified against hand-computed anchors:
  FICA is now computed per earner (Social Security wage base and
  Additional Medicare no longer applied to combined household gross);
  the Monthly check-in can no longer corrupt a loan's payment; loan
  interest is no longer overstated; FI / Coast-FI targets and the
  backtest's bond leg are consistently in real (inflation-adjusted)
  dollars, and real-dollar figures are labeled as such.
- **Honest screens**: pages no longer flash a false "no data" state while
  loading, and a degraded result replaces its cheerful caption instead of
  sitting next to it.
- **Accessibility**: visible keyboard focus throughout the new
  calculators, screen-reader announcements name the card they come from,
  focus is never dropped when menus and dialogs close, and contrast
  issues from the audit are fixed.
- **Hardening**: CSV import output is injection-safe, the app's file
  access is frozen behind a policy test, and the onboarding flow can no
  longer hang on first run.

## [1.0.2] - 2026-06-12

Intel Macs join in, and the Windows installer actually ships.

### Added

- **Intel Mac support**: the macOS build is now a **universal binary**
  (`Cairn_<version>_universal.app.tar.gz`) that runs natively on both Apple
  Silicon and Intel Macs — one download for every Mac. The in-app updater
  serves it to both architectures.

### Fixed

- **Windows installer now builds in CI.** The 1.0.1 Windows build failed while
  compiling a native, test-only dependency on the GitHub runner; the Windows
  build now skips that compile (it isn't needed to package the app), so
  `Cairn_<version>_x64-setup.exe` ships starting with this release.

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

[1.1.0]: https://github.com/Ray-Gochuico/Cairn/releases/tag/v1.1.0
[1.0.2]: https://github.com/Ray-Gochuico/Cairn/releases/tag/v1.0.2
[1.0.1]: https://github.com/Ray-Gochuico/Cairn/releases/tag/v1.0.1
[1.0.0]: https://github.com/Ray-Gochuico/Cairn/releases/tag/v1.0.0
