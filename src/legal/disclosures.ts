/**
 * Versioned disclosure copy.
 *
 * Every disclosure has a `version` string; bumping the version forces
 * existing users to re-accept via AppDisclaimerGate (app_wide) or the
 * Roadmap in-page gate (roadmap). The `diffFromPrevious` field is
 * surfaced in the modal when a re-prompt is shown, so users see what
 * actually changed instead of having to re-read the whole document.
 *
 * Edits to the copy itself MUST come with a version bump. Treat these
 * strings as a legal artifact, not a UI string — the user agreed to a
 * specific version, and changing the text without changing the version
 * silently rewrites what they consented to.
 *
 * Source of the copy: docs/superpowers/specs/2026-05-23-roadmap-design.md
 * § A.0 "Full draft disclosure copy".
 */

const APP_WIDE_TEXT_v1_5 = `**This app is an educational and personal-tracking tool. It is not financial, investment, tax, legal, or accounting advice.**

The app's developer is not a registered investment advisor, broker-dealer, certified financial planner, CPA, or attorney, and no fiduciary relationship is created by your use of it.

Calculations, projections, and recommendations are generated mechanically from the data you enter and from public reference data (e.g. IRS contribution limits, tax brackets, market prices via Yahoo Finance). They may be incomplete, outdated, or wrong. **You are solely responsible for verifying anything before acting on it**, and should consult a qualified professional for decisions that materially affect your finances.

Market data is sourced from third parties and may be delayed or inaccurate. Tax thresholds and regulations change; the app's reference data reflects a point in time and may not reflect current law.

The app stores all data locally on this device. The developer cannot recover lost data or restore a corrupted database.

Use of this app is **at your own risk**. The software is provided "as is" without warranty of any kind. To the maximum extent permitted by law, the developer disclaims all liability for any loss arising from its use.

**NO IMPLIED WARRANTIES.** TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE SOFTWARE IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE IMPLIED WARRANTIES OF **MERCHANTABILITY**, **FITNESS FOR A PARTICULAR PURPOSE**, ACCURACY, AND **NON-INFRINGEMENT**.

**Intended audience — U.S. only.** This software is provided for use by U.S. residents performing personal financial tracking on their own data. It is not localized for any other jurisdiction. Tax brackets, contribution limits, retirement account types, and other reference data reflect U.S. federal and state rules. If you are outside the United States, treat every tax calculation and contribution-limit comparison in this app as illustrative only — they will not match your local rules.

**What this app does NOT model.** The projections, calculators, and roadmap heuristics in this app omit several federal and state tax items that can materially shift the real-world outcome. Treat any number that depends on the items below as illustrative only:

- **Capital-gains state taxes.** State LTCG treatment varies widely — WA imposes a 7% tax on gains above ~$278k (2025 inflation-adjusted threshold), while CA/NY/HI/NJ tax LTCG as ordinary income, and TX/FL/NV/SD/TN/WY/AK have no state income tax at all. The app applies your state's ordinary brackets to any cap gains, which over-collects for some states and under-collects for others.
- **AMT (Alternative Minimum Tax)** for ISO exercises, large SALT add-backs, or other AMT preference items. Households exercising ISOs can owe substantial AMT in the exercise year.
- **Social Security retirement income.** The app does not project SS benefits or apply the federal 50%/85% taxation rules. Households relying primarily on SS in retirement will see different effective rates than projected.
- **Required Minimum Distributions (RMDs)** at age 73+. Pre-tax retirement accounts (Trad 401k/IRA) must distribute on a schedule; the app does not force these distributions into its projections.
- **§121 home sale exclusion** — \$250k single / \$500k MFJ of gain on the sale of a primary residence is excluded from tax. The app does not model home-sale events.
- **SALT cap / itemized-vs-standard election.** The app uses the standard deduction at every projection step; high-SALT households (NY/NJ/CA + property taxes) who itemize may see different federal tax outcomes.
- **Stock buyback excise tax (1%)** on corporate share repurchases — affects fund-level returns indirectly but is not modeled in any of the per-account growth projections.
- **Cafeteria-plan FICA exclusion.** §125 pre-tax health insurance, FSA, and payroll-deduction HSA contributions reduce the FICA base in payroll reality; the app applies FICA to raw gross. The over-collection is typically <\$500/yr for a household at the maximum cafeteria-plan deferral.
- **Drawdown tax gross-up assumption.** When What-If scenarios apply a non-zero drawdown tax rate (Settings → Advanced or per-scenario), the engine grosses up withdrawal amounts so the *net* expense baseline is met. This implicitly assumes the entire withdrawal is from pre-tax accounts. Households with significant Roth or after-tax balances will see actual taxes lower than projected.
- **Frozen tax brackets.** Tax brackets, IRS contribution limits, and HSA/HDHP thresholds are loaded from the snapshot baked into the app at build time (currently 2026 tax year). They are not auto-updated when the IRS publishes future-year values; long-horizon projections silently assume today's brackets persist nominally. Cross-check long-horizon strategies against the current IRS publication before acting.

**Governing law.** These terms are governed by the laws of the State of New York, without regard to its conflict-of-laws principles.`;

const ROADMAP_TEXT_v1_0 = `**About the Roadmap feature**

The roadmap is adapted from the community-maintained "/r/financialindependence flow chart, v4.3" (attribution: /u/happyasianpanda). It reflects one community's general framework — not a personalized financial plan.

Status badges ("Done", "Active", "Next up") are computed automatically from the data in this app. **The computation is mechanical and can be wrong** if your inputs are incomplete, your situation is unusual, or your jurisdiction is non-U.S. The chart assumes U.S. tax-advantaged accounts (401(k), IRA, HSA, ESPP, 529, 457(b)).

The roadmap classifies debt by annual interest rate: **< 5% low, 5–8% moderate, ≥ 8% high** (configurable in Settings → Advanced). The original community chart used "the prime rate" as a sliding reference; this app uses fixed thresholds for predictability.

Specific strategies the roadmap may suggest carry traps that the app does not fully evaluate. Examples:

- **Backdoor Roth IRA:** the IRS pro-rata rule can produce an unexpected tax bill if you hold any pre-tax IRA balance.
- **Mega backdoor Roth:** availability depends on your specific 401(k) plan documents; not all plans permit it.
- **Tax-loss harvesting:** wash-sale rules (30-day window across all your accounts including IRAs) can disallow the loss.
- **HSA contributions:** require an eligible HDHP for the *entire* contribution period; mid-year plan changes have proration rules.
- **529 → Roth IRA rollover (SECURE 2.0):** has account-age, beneficiary, and annual-limit conditions not modeled here.

Tax thresholds shown reflect the **2026 tax year** and will become outdated. Always verify current limits with IRS publications.

**Consult a tax professional or fee-only fiduciary advisor before executing any of these strategies.**`;

// History note: v1.0 described returns as "nominal index returns" (wrong — the
// engine runs in real dollars; corrected in v1.1). v1.1 said coverage ran
// "1871 to today" and used 2000 as an example start (wrong — Shiller data ends
// 2022; corrected here in v1.2). Superseded bodies are not retained as
// constants (noUnusedLocals); the per-version diffs live in `diffFromPrevious`
// below and the full history is in git.
// v1.3 (W1, 2026-08-25) adds the Stress Test card to the doc's coverage: a
// both-surfaces opening + the bracket line scoped to the Backtest tool.
// v1.3 (stress surfaces) superseded by v1.4 (History view added): W2
// (2026-09-02) widens the opening to a THIRD view — the History fan on the
// Path to FI and Compound Interest calculators — and appends one paragraph
// describing it. Every other v1.3 paragraph is carried over byte-identically.
const BACKTEST_TEXT_v1_4 = `**About the Historical Backtest**

This data replays your plan against U.S. market data from 1871 to 2022, in three views. The **Backtest tool** replays every historical starting year — what would have happened to someone who began this exact plan in 1929, 1966, 1973, and so on; only start years with a full horizon of data are shown (for a 30-year horizon the latest start is 1993, since the data ends in 2022). The **Stress Test card** replays a handful of named historical windows — specific starting sequences from the same dataset (the 1929 crash, the 1970s inflation run, and so on) — against the portfolio and contributions you hold today, and the **History view** on the Path to FI and Compound Interest calculators replays your contribution plan against every full-length stretch in the same dataset. All three are history replayed, never a forecast.

**Past results do not predict future returns.** This is the most important sentence on this page. The U.S. market has only ~120 *overlapping* 30-year windows since 1871 — they share most of their years, so they are **not independent samples**, and a "94 of 120" success count is **not a 94/120 probability**. The next 30 years will be a new window not in this dataset. Backtests systematically miss tail risks that have not happened yet (a U.S. default, a multi-decade stagnation, a regime change in tax law). A named stress window is one sequence that happened once — it is not a probability of anything.

The **success rate is a count of past outcomes, not a probability** of future success. Raising the *goal ending amount* above $0 makes "success" stricter — you are asking the plan to also leave a margin — but it stays a tally of what *did* happen, never a forecast of what will.

Everything in these replays is computed in **real (CPI-adjusted) dollars** — both your inputs and the results are stated in today's purchasing power. The returns applied each year are **real (CPI-adjusted) total returns for a stock/bond blend**: the stock leg is Shiller's CPI-deflated S&P total return and the bond leg is a 10-year U.S. Treasury total return deflated to real, weighted by the stock percentage you chose and rebalanced annually. Those returns are applied **gross of fees** — your own real portfolio will diverge based on fund expense ratios, asset location, and how your actual allocation differs from the chosen stock percentage. **Tax brackets are held at 2026 levels** across the Backtest tool's entire 1871-to-2022 replay — historical brackets are not reconstructed, so any income-tax treatment is approximate; the Stress Test card applies no tax treatment at all. See *Settings → Disclosures* for the full assumption set.

The **History view** on the Path to FI and Compound Interest calculators replays a contribution plan (no withdrawals) against the same dataset: every full-length historical stretch at a fixed 75% stock / 25% bond real-return blend, rebalanced annually. At each year it reports the middle half (25th–75th percentile) and median of the balances those stretches had reached, and — where a target exists — a count of the stretches that reached the target within the horizon. The same rules apply: overlapping stretches are not independent samples, the count is a tally of past outcomes and never a probability, returns are real (CPI-adjusted) and gross of fees, and the view is history, not a forecast.`;

const LEARNING_TEXT_v1_0 = `**About the Learning feature**

Daily trivia questions are written for general financial-literacy education. They are **not personalized advice** and do not account for your specific situation, jurisdiction, or filing year.

Tax thresholds, contribution limits, and account rules referenced reflect the version shipped with this build. The IRS publishes new contribution limits annually and federal/state legislation can move limits, phase-outs, and credit thresholds in any year. **Verify any number you would act on against current IRS publications or a qualified professional.**

Content is hand-curated; errors are possible. If a question looks wrong, treat the underlying rule as the authority. The "Source" line names the canonical reference (e.g., "IRS Pub 590-A") — read it before relying on the trivia.

**Trivia is for vocabulary and intuition; decisions belong with a CFP, CPA, or attorney.**`;

const INTERVIEW_TEXT_v1_1 = `## Mechanical frameworks, not advice

The question bar and the "Questions for you" cards apply **fixed, mechanical frameworks** to numbers you entered. Nothing here is personalized financial advice, a recommendation, or a prediction.

**How the three frameworks work.** Conservative, Moderate, and Aggressive are three fixed orderings of the same six buckets: a starter emergency fund, employer match, high-rate debt, a fuller emergency reserve, mid-rate debt, and investing. They differ only in the reserve size they target and how they weight mid-rate debt against investing. The split you see is arithmetic over your balances, rates, and expense baseline — the same inputs the Roadmap reads.

**What this app does not know.** Your taxes in detail, your job security beyond what you told it, your health, your family plans, your risk tolerance. A framework cannot weigh what it cannot see.

**Every figure states its basis.** If a number's basis line says a value is assumed or missing, treat the figure as illustrative only.

**Projections are not predictions.** Growth figures use your saved scenario rates and are shown in today's dollars. Real returns vary and can be negative.

**Reference data.** College-cost figures are the College Board's published sticker-price averages for the 2025-26 academic year, bundled with this app and grown at each sector's published long-run rate above inflation. They are list prices, not what any family pays after aid, and they age. State 529 deduction hints are a static snapshot. Verify costs with the school and deduction rules with your state's Department of Revenue.

Decisions about debt, investing, and reserves belong with you — and, for anything consequential, a CFP, CPA, or attorney.`;

export interface DisclosureDocument {
  version: string;
  /** Modal heading for this disclosure (e.g. "Disclaimer"). */
  title: string;
  body: string;
  /** Optional summary of changes since the previous version, shown in re-prompts. */
  diffFromPrevious?: string;
  acceptanceCheckboxLabel: string;
}

export const DISCLOSURES = {
  app_wide: {
    version: '1.5',
    title: 'Disclaimer',
    body: APP_WIDE_TEXT_v1_5,
    diffFromPrevious:
      "Version 1.5 adds two new bullets to 'What this app does NOT model': drawdown tax gross-up assumption (engine treats withdrawals as fully pre-tax) and frozen-bracket assumption (built-in tax tables don't auto-update for future years). No other content changes since v1.4. Please re-read and re-accept.",
    acceptanceCheckboxLabel:
      'I have read and understand the above. I accept that this app is not financial advice and I use it at my own risk.',
  } satisfies DisclosureDocument,
  roadmap: {
    version: '1.0',
    title: 'About the Roadmap',
    body: ROADMAP_TEXT_v1_0,
    acceptanceCheckboxLabel:
      'I understand the Roadmap is algorithmic, not personalized advice, and I will consult a professional before acting on tax-sensitive strategies.',
  } satisfies DisclosureDocument,
  learning: {
    version: '1.0',
    title: 'About the Learning feature',
    body: LEARNING_TEXT_v1_0,
    acceptanceCheckboxLabel:
      'I understand the trivia content is general financial-literacy education, not advice, and I will verify any specifics before acting.',
  } satisfies DisclosureDocument,
  backtest: {
    version: '1.4',
    title: 'About the Historical Backtest',
    body: BACKTEST_TEXT_v1_4,
    diffFromPrevious:
      'Version 1.4 adds the History view on the Path to FI and Compound Interest calculators: the same 1871–2022 dataset now also drives an accumulation-side percentile band (the middle half and median across every full-length historical stretch) plus a reached-the-target count on those two cards. The opening now names those surfaces alongside the surfaces named in v1.3. No change to the count-not-probability, overlapping-windows, real-returns, or gross-of-fees framing carried over from v1.3. Please re-read and re-accept.',
    acceptanceCheckboxLabel:
      'I understand the backtest and stress test report historical outcomes only and are not a prediction of future performance.',
  } satisfies DisclosureDocument,
  interview: {
    version: '1.1',
    title: 'About the Frameworks',
    body: INTERVIEW_TEXT_v1_1,
    diffFromPrevious:
      "Version 1.1 adds a 'Reference data' paragraph: the college questions use bundled College Board 2025-26 sticker-price averages grown at published above-inflation rates — list prices, not post-aid costs — plus static state 529 deduction hints. No other content changes since v1.0. Please re-read and re-accept.",
    acceptanceCheckboxLabel:
      'I understand these are mechanical frameworks applied to my numbers — educational, not personalized financial advice.',
  } satisfies DisclosureDocument,
} as const;

export type DisclosureId = keyof typeof DISCLOSURES;
