# Changelog

All notable changes to Cairn are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0] - 2026-08-25

Two new questions the Roadmap can ask — buying a home, and college
versus retirement — plus a sharper positions table and a wide sweep of
fixes. Your database upgrades automatically on first launch.

### Added

- **"Are there plans to buy a home?"** When you rent (or the app can't
  tell), the Roadmap can ask. Answer with a target amount and month
  and it computes a savings plan from your actual cash and savings —
  declaring plainly when those same dollars are also your emergency
  fund — can track the target as a Goal with one click, and keeps the
  Roadmap's large-purchase question in sync automatically. Owners
  aren't asked.
- **College vs. retirement.** With a dependent or a 529 on file, the
  Roadmap can ask what goes toward college each month and answers with
  both sides: the projected 529 balance against published tuition
  prices (bundled College Board 2025-26 sticker-price averages, grown
  at published above-inflation rates — list prices, not post-aid
  costs, stated on the card), and what the same dollars would mean for
  financial independence. State 529 deduction hints where encoded.
  The frameworks disclosure gains a "Reference data" paragraph, so
  you'll be asked to re-read and re-accept it once.
- **Sortable positions and day change.** Click any column in the
  Positions table to sort within every account (unpriced holdings stay
  last), and a new "Day change" column shows each holding's move as of
  your last refresh — nothing auto-polls, as always.
- Settings can now choose which spending categories count as vehicle
  repairs for the Roadmap's car questions.
- The Dashboard briefing can point you to the Roadmap's "what's next"
  bar once it's ready for you.

### Fixed

- New accounts no longer silently lose their employer-match answers —
  they were dropped on create through every entry path.
- A household whose only earner is paid hourly now sees an explained
  paycheck estimate instead of an unqualified $0.
- Leaving "Revisit setup" midway no longer nudges finished profiles to
  continue setup.
- Date questions that can't accept a month now say why instead of
  silently disabling Save.
- Assorted polish: honest dashes wherever day-change data hasn't been
  fetched, a vehicle's interview answers are cleaned up when the
  vehicle is deleted, duplicate-free tax-table loading, and sturdier
  tests throughout.

## [1.4.0] - 2026-08-09

Setup now talks you through it, and Investments shows your positions
the way a brokerage does. Your database upgrades automatically on
first launch.

### Added

- **Guided setup, question by question.** Setting up Cairn is now a
  conversation — "Are you married?", "How is each of you paid?" —
  small grouped questions that reveal only the follow-ups that apply
  to you, with yes/no gates that open the familiar entry cards for
  accounts, loans, home, vehicles, and history, or skip them
  entirely. Every answer lands in the same fields you edit later
  under Inputs (nothing is stored twice), "Switch to form view"
  swaps to the classic card wizard at any time without losing your
  place, and Settings gains "Revisit setup" — the same flow, with
  your saved answers filled in.
- **A positions view on Investments.** The renamed "Allocation &
  positions" card lists every holding per account, brokerage-style:
  name and ticker, last fetched price, change since your last
  refresh, total gain/loss against your cost basis, current value,
  share of the account, quantity, cost basis with per-share, and the
  52-week range. Values in this table use your last-fetched prices ×
  shares — stated right on the card — and anything the app doesn't
  know renders as "—", never a made-up zero. Prices and 52-week
  ranges update only when you click refresh, as always.

### Changed

- The asset-class table's "Invested" column is now labeled "Value" —
  it always showed current value, and the new positions table is
  where cost basis actually lives.

### Fixed

- A saved filing status could render as blank (or fall back to
  Single) after a reload even though it was stored correctly — a
  long-dormant display bug that mattered once setup made every
  filing status easy to choose. Selections now survive reloads.

## [1.3.0] - 2026-08-08

Ask the Roadmap "what's next" — a question bar and interview questions
that apply fixed, mechanical frameworks to your own numbers, computed
entirely on your machine. Your database upgrades automatically on
first launch.

### Added

- **"I have $X — what's next?"** A question bar on the Roadmap: enter
  an amount, one-time or per month, and three framework cards —
  Conservative, Moderate, and Aggressive — show how each fixed
  ordering would split that money across your emergency fund, employer
  match, debt, and investing, using the balances, rates, and expense
  baseline you've already entered. Every figure states its basis on
  the card; a "What this assumes" section lists the assumptions and
  every reason a bucket was skipped; per-month splits show a
  First / Then / Ongoing schedule. The first use explains exactly what
  the frameworks are and are not — mechanical arithmetic, never a
  recommendation.
- **Questions for you.** The Roadmap can now ask about things your
  data suggests are worth a look — starting with cars: when a
  vehicle's model year, value trend, or categorized repair spending
  warrants it, a card asks about replacement plans, and a named budget
  becomes the monthly saving it implies (with and without growth).
  Answers are saved, re-askable ("Ask me again"), and re-confirmed
  calmly when they age or the facts beneath them change.
- Card effects come from the same engines the rest of the app uses:
  months of expenses covered, interest and payoff dates versus minimum
  payments, employer-match value, and years-to-FI deltas — in today's
  dollars, each labeled with the scenario it assumes.

### Changed

- The Roadmap hosts the question bar below the next-step hero and the
  "Questions for you" strip below the sections — behind the page's
  existing disclosure gate, household-scoped like the rest of the page.

## [1.2.0] - 2026-08-06

Every page, per person — plus a setup flow that shows you what you've
saved, and a home for every number you've entered. Your database
upgrades automatically on first launch.

### Added

- **See everything for one person.** The Household / person / joint
  switch now genuinely works everywhere: pick a person and every page —
  Dashboard, Net Worth, Investments, Spending, Loans, Property,
  Vehicles, Goals, Budget, the Monthly check-in, and all ten
  calculators — shows that person's numbers with honest captions
  ("3 of 10 — 3 joint and 4 owned by Alex not shown"). Joint items are
  never silently assigned to one person, empty filtered views explain
  themselves instead of pretending you have no data, and pages whose
  math is inherently household-wide (What-If, Roadmap) now say so
  plainly instead of showing a switch that does nothing.
- **Per-person monthly expenses.** Each person can now have their own
  expense figure (Setup → People), and person-scoped calculators say
  exactly which basis they used — "from Alex's Inputs" when set, or a
  clearly-labeled even split of the household baseline when not.
- **A home for every number.** Growth scenarios get a real editor
  (Household settings); every account has a viewable balance history
  with corrections; recorded loan payments are listed per loan and can
  be deleted safely — the loan balance is restored automatically, so a
  delete-and-reconfirm can never double-count; and the Roadmap now
  lists the assumptions you've told it, each with an "Ask again"
  button, so one mis-click is no longer permanent.
- **The calculators' scenario bar can scope per person too** — with
  per-person what-if values kept separate per view, and "Send to
  What-If" that works reliably (including right after the app starts).

### Changed

- **Setup shows what you've saved.** Reopening the setup wizard now
  shows your actual data — named entries with real values ("Married
  filing jointly · CA · $6,000/mo baseline", salaries on the employment
  chips, "12 snapshots across 6 accounts") — instead of "Start this
  section" screens over a full database. Section markers honestly show
  where saved data exists, and if you leave setup unfinished the
  Dashboard offers to resume where you left off.
- **Calculator polish**: honesty captions get room to breathe instead
  of truncating, full-page tools (Paycheck, Backtest) return you to
  exactly where you were — same person view, same open card — and the
  scenario bar reads more calmly at every window size.

### Fixed

- Deleting a recorded loan payment restores the loan balance (the
  delete + re-confirm flow is now provably balance-neutral).
- "Send to What-If" no longer fails after restarting the app, and edits
  that don't map to a What-If lever say so instead of creating an empty
  scenario.
- Assorted honesty fixes: loading states never claim "nothing here"
  while data is still loading, hourly rates keep their cents, and
  renaming the "Moderate" growth scenario now warns that calculators
  headline that row.

## [1.1.1] - 2026-07-20

Fixes from the first round of user feedback on 1.1.0 — thank you for
reporting.

### Fixed

- **Export CSV works in the installed app.** Every "Export CSV" button
  (and the import template download) was silently doing nothing in the
  desktop app. Exports now open a native save dialog; if a write fails
  after you pick a location, the app says so instead of pretending it
  worked.
- **New tickers get market data right away.** Adding a holding (or
  changing its ticker, or importing holdings from CSV) now fetches the
  price and updates your account totals immediately — previously a new
  ticker waited for the next scheduled refresh, which could be a day
  away or never on the manual setting.
- **Stocks are no longer falsely flagged as "couldn't be
  auto-classified."** The warning now appears only when classification
  actually failed, not for every stock added after setup.
- **"Refresh now" tells you what happened.** The refresh button (in
  Settings → Market data and the freshness pill) now genuinely waits for
  the fetch and reports any ticker it couldn't price — including which
  account totals were left unchanged — instead of finishing instantly
  and silently.

### Added

- **Setup shows what you've created.** Every step of the setup wizard
  now lists the things you've added — accounts, holdings, properties,
  vehicles, loans, goals — as named chips, so you can see at a glance
  that an add worked (previously only people got this treatment, and
  everything else showed just a count).
- **The "Add a holding" step has column titles.** Ticker, Shares,
  Target % and Cost basis are now labeled above their boxes in the setup
  wizard, matching the rest of the app's forms.

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

[1.2.0]: https://github.com/Ray-Gochuico/Cairn/releases/tag/v1.2.0
[1.1.1]: https://github.com/Ray-Gochuico/Cairn/releases/tag/v1.1.1
[1.1.0]: https://github.com/Ray-Gochuico/Cairn/releases/tag/v1.1.0
[1.0.2]: https://github.com/Ray-Gochuico/Cairn/releases/tag/v1.0.2
[1.0.1]: https://github.com/Ray-Gochuico/Cairn/releases/tag/v1.0.1
[1.0.0]: https://github.com/Ray-Gochuico/Cairn/releases/tag/v1.0.0
