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

const LEARNING_TEXT_v1_0 = `**About the Learning feature**

Daily trivia questions are written for general financial-literacy education. They are **not personalized advice** and do not account for your specific situation, jurisdiction, or filing year.

Tax thresholds, contribution limits, and account rules referenced reflect the version shipped with this build. The IRS publishes new contribution limits annually and federal/state legislation can move limits, phase-outs, and credit thresholds in any year. **Verify any number you would act on against current IRS publications or a qualified professional.**

Content is hand-curated; errors are possible. If a question looks wrong, treat the underlying rule as the authority. The "Source" line names the canonical reference (e.g., "IRS Pub 590-A") — read it before relying on the trivia.

**Trivia is for vocabulary and intuition; decisions belong with a CFP, CPA, or attorney.**`;

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
} as const;

export type DisclosureId = keyof typeof DISCLOSURES;
