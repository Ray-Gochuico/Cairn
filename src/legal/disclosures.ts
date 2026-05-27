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

const APP_WIDE_TEXT_v1_2 = `**This app is an educational and personal-tracking tool. It is not financial, investment, tax, legal, or accounting advice.**

The app's developer is not a registered investment advisor, broker-dealer, certified financial planner, CPA, or attorney, and no fiduciary relationship is created by your use of it.

Calculations, projections, and recommendations are generated mechanically from the data you enter and from public reference data (e.g. IRS contribution limits, tax brackets, market prices via Yahoo Finance). They may be incomplete, outdated, or wrong. **You are solely responsible for verifying anything before acting on it**, and should consult a qualified professional for decisions that materially affect your finances.

Market data is sourced from third parties and may be delayed or inaccurate. Tax thresholds and regulations change; the app's reference data reflects a point in time and may not reflect current law.

The app stores all data locally on this device. The developer cannot recover lost data or restore a corrupted database.

Use of this app is **at your own risk**. The software is provided "as is" without warranty of any kind. To the maximum extent permitted by law, the developer disclaims all liability for any loss arising from its use.

**NO IMPLIED WARRANTIES.** TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE SOFTWARE IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE IMPLIED WARRANTIES OF **MERCHANTABILITY**, **FITNESS FOR A PARTICULAR PURPOSE**, ACCURACY, AND **NON-INFRINGEMENT**.

**Intended audience — U.S. only.** This software is provided for use by U.S. residents performing personal financial tracking on their own data. It is not localized for any other jurisdiction. Tax brackets, contribution limits, retirement account types, and other reference data reflect U.S. federal and state rules. If you are outside the United States, treat every tax calculation and contribution-limit comparison in this app as illustrative only — they will not match your local rules.

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

export interface DisclosureDocument {
  version: string;
  body: string;
  /** Optional summary of changes since the previous version, shown in re-prompts. */
  diffFromPrevious?: string;
  acceptanceCheckboxLabel: string;
}

export const DISCLOSURES = {
  app_wide: {
    version: '1.2',
    body: APP_WIDE_TEXT_v1_2,
    diffFromPrevious:
      'Version 1.2 fills in the governing-law clause: it now references the State of New York as the governing law (previously a placeholder string). No other substantive change. Please re-read and re-accept.',
    acceptanceCheckboxLabel:
      'I have read and understand the above. I accept that this app is not financial advice and I use it at my own risk.',
  } satisfies DisclosureDocument,
  roadmap: {
    version: '1.0',
    body: ROADMAP_TEXT_v1_0,
    acceptanceCheckboxLabel:
      'I understand the Roadmap is algorithmic, not personalized advice, and I will consult a professional before acting on tax-sensitive strategies.',
  } satisfies DisclosureDocument,
} as const;

export type DisclosureId = keyof typeof DISCLOSURES;
