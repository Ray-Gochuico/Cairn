import type { NodeId, RoadmapNode } from '@/types/roadmap';
import {
  evaluateSmallEmergencyFund,
  evaluateEmergencyFund3Months,
  evaluateEmergencyFund6To12Months,
} from './rules/emergencyFund';
import {
  evaluateHighInterestDebt,
  evaluateModerateInterestDebt,
  evaluateModerateDebtQ,
  evaluateLowInterestDebt,
} from './rules/debtClassification';
import {
  evaluateIraBand,
  evaluateBackdoorRoth,
  evaluateRothIra,
  evaluateTraditionalIra,
} from './rules/iraBranch';
import {
  evaluateCreateBudget,
  evaluateSection0Info,
} from './rules/budgetEssentials';
import {
  evaluateIps,
  evaluateNonEssentials,
  evaluateTrackExpenses,
  evaluateEmployerMatchQ,
  evaluateEmployerMatch,
  evaluateJobStability,
} from './rules/section1';
import {
  evaluatePickInsurance,
  evaluateHdhpQ,
  evaluateContributeHsa,
  evaluateSaveReceipts,
  evaluateHsaFeesQ,
  evaluateRolloverHsa,
  evaluateKeepEmployerHsa,
} from './rules/hsa';
import {
  evaluateEarnedIncomeQ,
  evaluateContributeIra,
  evaluateExpectHigherIncomeQ,
  evaluateSolo401k,
  evaluateAfterTax401kQ,
  evaluateMegaBackdoor,
} from './rules/section4Misc';
import {
  evaluateEsppQ,
  evaluateEsppAction,
  evaluateLargePurchasesQ,
  evaluateSaveShortTerm,
  evaluateEmploymentTypeQ,
  evaluateMax401k,
  evaluatePrioritizeIraVs401k,
  evaluate529,
  evaluateTaxableBrokerage,
  evaluateTaxLossHarvest,
  evaluateCharitableDaf,
  evaluateRebalance,
} from './rules/sections5to6';

/**
 * Declarative registry of every Roadmap chart node.
 *
 * The Roadmap feature is *adapted from* the community-maintained
 * /r/financialindependence flow chart v4.3 (attribution to
 * /u/happyasianpanda lives in src/legal/disclosures.ts § Roadmap).
 * All copy below is the developer's own paraphrase of the chart's
 * sections 0–6 — no verbatim chart prose ships in this bundle. The
 * sequencing and section structure are the chart's; the wording is
 * original. See docs/reviews/2026-05-26-legal-review.md finding #2
 * for the rationale for paraphrasing rather than redistributing.
 *
 * Sub-Plan B shipped the skeleton + three rule files (emergencyFund,
 * debtClassification, iraBranch); Sub-Plan C wired the remaining ~30
 * evaluators across budgetEssentials, section1, hsa, section4Misc,
 * and sections5to6.
 *
 * Node IDs use the pattern `s<section>_<short_name>`. They are stable
 * identifiers — never renamed once shipped, because they're the foreign
 * key in roadmap_node_overrides.
 */

export const NODES: ReadonlyArray<RoadmapNode> = [
  // ──────────────────────────────────────────────────────────────────
  // Section 0 — Budget & Essentials (7 action nodes, linear)
  // ──────────────────────────────────────────────────────────────────
  {
    id: 's0_create_budget',
    section: 0,
    kind: 'action',
    title: 'Set up a working budget',
    body: 'Write down what you earn and what you spend; you cannot prioritize what you cannot see.',
    prerequisites: [],
    evaluate: evaluateCreateBudget,
  },
  {
    id: 's0_pay_rent',
    section: 0,
    kind: 'action',
    title: 'Cover housing first',
    body: 'Rent or mortgage, plus renters or homeowners insurance if your lease or loan requires it.',
    prerequisites: ['s0_create_budget'],
    evaluate: evaluateSection0Info('s0_pay_rent'),
  },
  {
    id: 's0_buy_food',
    section: 0,
    kind: 'action',
    title: 'Cover groceries',
    body: 'Food for the household. If your utilities are about to be cut off, address those first instead.',
    prerequisites: ['s0_pay_rent'],
    evaluate: evaluateSection0Info('s0_buy_food'),
  },
  {
    id: 's0_pay_essentials',
    section: 0,
    kind: 'action',
    title: 'Cover essential utilities',
    body: 'Electricity, water, heat, basic household supplies — the bills you cannot defer without losing the service.',
    prerequisites: ['s0_buy_food'],
    evaluate: evaluateSection0Info('s0_pay_essentials'),
  },
  {
    id: 's0_income_expenses',
    section: 0,
    kind: 'action',
    title: 'Cover what keeps your income flowing',
    body: 'Commute costs, work phone or internet — whatever is required to keep your paychecks arriving.',
    prerequisites: ['s0_pay_essentials'],
    evaluate: evaluateSection0Info('s0_income_expenses'),
  },
  {
    id: 's0_pay_health_care',
    section: 0,
    kind: 'action',
    title: 'Cover health coverage and care',
    body: 'Health insurance premiums and unavoidable medical bills.',
    prerequisites: ['s0_income_expenses'],
    evaluate: evaluateSection0Info('s0_pay_health_care'),
  },
  {
    id: 's0_min_debt_payments',
    section: 0,
    kind: 'action',
    title: 'Keep every loan current at the minimum',
    body: 'Cover the minimum due on every balance you owe — credit cards, student loans, anything else — to avoid delinquency, late fees, and credit damage before you optimize anything.',
    prerequisites: ['s0_pay_health_care'],
    evaluate: evaluateSection0Info('s0_min_debt_payments'),
  },

  // ──────────────────────────────────────────────────────────────────
  // Section 1 — Employer Match & Emergency Fund (8 nodes)
  // ──────────────────────────────────────────────────────────────────
  {
    id: 's1_emergency_small',
    section: 1,
    kind: 'action',
    title: 'Build a starter emergency cushion',
    body: 'Stash the larger of one thousand dollars or one month of expenses somewhere liquid — typically a high-yield savings account at an FDIC-insured institution.',
    prerequisites: ['s0_min_debt_payments'],
    evaluate: evaluateSmallEmergencyFund,
  },
  {
    id: 's1_evaluate_non_essentials',
    section: 1,
    kind: 'action',
    title: 'Review discretionary spending',
    body: 'Trim subscriptions and other non-essentials where it is painless; for the rest, at least keep them current so you are not also fighting late fees.',
    prerequisites: ['s1_emergency_small'],
    evaluate: evaluateNonEssentials,
  },
  {
    id: 's1_track_expenses',
    section: 1,
    kind: 'action',
    title: 'Log every expense',
    body: 'Capturing every outflow surfaces the categories worth cutting and the ones already in line with your goals.',
    prerequisites: ['s1_evaluate_non_essentials'],
    evaluate: evaluateTrackExpenses,
  },
  {
    id: 's1_consider_ips',
    section: 1,
    kind: 'info',
    title: 'Consider an Investment Policy Statement (IPS)',
    body: 'An IPS is a short written set of rules — target allocation, rebalancing triggers, contribution defaults — that you commit to in calm conditions so a market panic does not force you to invent a plan on the fly.',
    prerequisites: ['s1_track_expenses'],
    evaluate: evaluateIps,
  },
  {
    id: 's1_employer_match_q',
    section: 1,
    kind: 'decision',
    title: 'Does your job include an employer match on retirement contributions?',
    body: 'If yes, the next step grabs the full match. If no, you can skip the match step entirely.',
    prerequisites: ['s1_consider_ips'],
    evaluate: evaluateEmployerMatchQ,
  },
  {
    id: 's1_employer_match',
    section: 1,
    kind: 'action',
    title: 'Take the full employer match',
    body: 'Set your contribution rate to exactly what unlocks the full match — no less, but also no more for now; further retirement saving comes back in Section 4 and beyond.',
    prerequisites: ['s1_employer_match_q'],
    evaluate: evaluateEmployerMatch,
  },
  {
    id: 's1_high_interest_debt',
    section: 1,
    kind: 'action',
    title: 'Knock out high-interest debt',
    body: 'In this app, any debt at or above an 8% annual rate is treated as high-interest (default threshold; configurable under Settings → Advanced). Clear these first — at those rates they compound faster than any reasonable expected return on investments.',
    prerequisites: ['s1_employer_match'],
    evaluate: evaluateHighInterestDebt,
  },
  {
    id: 's1_job_stability_q',
    section: 1,
    kind: 'decision',
    title: 'How predictable is your income?',
    body: 'Predictable / steady → target a 3-month fund. Volatile, seasonal, or commission-heavy → target 6–12 months instead.',
    prerequisites: ['s1_high_interest_debt'],
    evaluate: evaluateJobStability,
  },
  {
    id: 's1_emergency_3mo',
    section: 1,
    kind: 'action',
    title: 'Grow the emergency fund to about three months',
    body: 'Hold it somewhere liquid and capital-safe — an FDIC-insured savings account, short Treasury bills, or a conservative money-market fund.',
    prerequisites: ['s1_job_stability_q'],
    evaluate: evaluateEmergencyFund3Months,
  },
  {
    id: 's1_emergency_6_12mo',
    section: 1,
    kind: 'action',
    title: 'Grow the emergency fund to six to twelve months',
    body: 'Same liquidity bar as the three-month version; a laddered set of short CDs sized to monthly burn is a reasonable alternative when the balance gets large.',
    prerequisites: ['s1_job_stability_q'],
    evaluate: evaluateEmergencyFund6To12Months,
  },

  // ──────────────────────────────────────────────────────────────────
  // Section 2 — Debt Reduction (2 nodes)
  // ──────────────────────────────────────────────────────────────────
  {
    id: 's2_moderate_debt_q',
    section: 2,
    kind: 'decision',
    title: 'Any moderate-interest balances left?',
    body: 'In this app, a loan between 5% and 8% annual rate counts as moderate-interest (configurable). If you carry any, work them down here.',
    prerequisites: ['s1_emergency_3mo', 's1_emergency_6_12mo'],
    evaluate: evaluateModerateDebtQ,
  },
  {
    id: 's2_moderate_debt_action',
    section: 2,
    kind: 'action',
    title: 'Refinance where you can, then attack by rate',
    body: 'First try to get the rate itself down — refinance, balance-transfer offers, hardship programs. Then pay extra against whichever remaining balance has the highest rate (the avalanche order).',
    prerequisites: ['s2_moderate_debt_q'],
    evaluate: evaluateModerateInterestDebt,
  },

  // ──────────────────────────────────────────────────────────────────
  // Section 3 — HSA (7 nodes)
  // ──────────────────────────────────────────────────────────────────
  {
    id: 's3_pick_medical_insurance',
    section: 3,
    kind: 'action',
    title: 'Pick a medical plan that actually fits',
    body: 'Compare premium, deductible, network, and out-of-pocket maximum across the plan types your employer (or the marketplace) offers — PPO, HMO, EPO, POS, HDHP. If you are under 26, a parent plan is often worth pricing too.',
    prerequisites: ['s2_moderate_debt_action'],
    evaluate: evaluatePickInsurance,
  },
  {
    id: 's3_hdhp_q',
    section: 3,
    kind: 'decision',
    title: 'Are you enrolled in an HSA-eligible HDHP?',
    body: 'Only an HSA-qualified high-deductible plan unlocks HSA contributions. If yes, the HSA branch below applies. If no, jump to Section 4 (IRA).',
    prerequisites: ['s3_pick_medical_insurance'],
    evaluate: evaluateHdhpQ,
  },
  {
    id: 's3_contribute_hsa',
    section: 3,
    kind: 'action',
    title: 'Fund the HSA',
    body: 'When the contribution is routed through payroll, it usually escapes FICA in addition to income tax — a benefit you do not get from depositing into a standalone HSA after the fact. For a relatively healthy household, the HDHP-plus-HSA combo is often the cheapest plan over a full year.',
    prerequisites: ['s3_hdhp_q'],
    evaluate: evaluateContributeHsa,
  },
  {
    id: 's3_save_receipts',
    section: 3,
    kind: 'action',
    title: 'Archive qualified medical receipts',
    body: 'Set up somewhere — a folder, a scanning app, a tagged email label — to retain receipts for qualified medical expenses. There is no deadline to reimburse yourself from an HSA, so years later these receipts let you pull money out tax-free.',
    prerequisites: ['s3_contribute_hsa'],
    evaluate: evaluateSaveReceipts,
  },
  {
    id: 's3_hsa_fees_q',
    section: 3,
    kind: 'decision',
    title: 'Is your employer HSA carrying high fees?',
    body: 'If account maintenance fees or expense ratios are noticeably worse than retail HSA brokerages, a rollover is worth it. Otherwise keep contributing where you already are.',
    prerequisites: ['s3_save_receipts'],
    evaluate: evaluateHsaFeesQ,
  },
  {
    id: 's3_rollover_hsa',
    section: 3,
    kind: 'action',
    title: 'Move the balance to a cheaper HSA custodian',
    body: 'A trustee-to-trustee transfer between HSAs is generally non-taxable and you can do it as often as needed; the once-per-year IRS rollover restriction is for indirect rollovers, not direct transfers.',
    prerequisites: ['s3_hsa_fees_q'],
    evaluate: evaluateRolloverHsa,
  },
  {
    id: 's3_keep_employer_hsa',
    section: 3,
    kind: 'info',
    title: 'Stay with the employer HSA and turn investing on',
    body: 'Most employer HSAs require a minimum cash balance before excess dollars can be invested. Once you clear that minimum, set new contributions to flow into the investment sleeve instead of the cash sweep.',
    prerequisites: ['s3_hsa_fees_q'],
    evaluate: evaluateKeepEmployerHsa,
  },

  // ──────────────────────────────────────────────────────────────────
  // Section 4 — IRA (8 nodes)
  // ──────────────────────────────────────────────────────────────────
  {
    id: 's4_earned_income_q',
    section: 4,
    kind: 'decision',
    title: 'Do you have earned income this year?',
    body: 'IRA contributions need wages, salary, or self-employment income to back them. Up until each year\'s tax-filing deadline (around April 15), you can also still backfill an IRA contribution for the previous calendar year.',
    prerequisites: ['s3_rollover_hsa', 's3_keep_employer_hsa'],
    evaluate: evaluateEarnedIncomeQ,
  },
  {
    id: 's4_contribute_ira',
    section: 4,
    kind: 'action',
    title: 'Start an IRA contribution and check MAGI',
    body: 'Open or fund an IRA, then compute your Modified Adjusted Gross Income so the next step can route you to the right Roth-vs-traditional branch.',
    prerequisites: ['s4_earned_income_q'],
    evaluate: evaluateContributeIra,
  },
  {
    id: 's4_ira_band',
    section: 4,
    kind: 'info',
    title: 'Pick the branch your MAGI puts you in',
    body: 'Roughly: above about $153k single (or $242k jointly), direct Roth contributions phase out — use a backdoor Roth. In the middle band — about $81k–$153k single or $129k–$242k jointly — a direct Roth contribution is generally the right move. Below that, you have a real choice between Roth and traditional, decided in the next step. (Verify current-year IRS thresholds — the app stores the 2026 values.)',
    prerequisites: ['s4_contribute_ira'],
    evaluate: evaluateIraBand,
  },
  {
    id: 's4_backdoor_roth',
    section: 4,
    kind: 'action',
    title: 'Use the backdoor Roth (contribute non-deductible, then convert)',
    body: 'For income levels above the direct Roth limit. Caution: if you hold any pre-tax balance in a traditional, SEP, or SIMPLE IRA, the IRS pro-rata rule will tax part of the conversion in proportion to those pre-tax dollars.',
    prerequisites: ['s4_ira_band'],
    evaluate: evaluateBackdoorRoth,
  },
  {
    id: 's4_roth_ira',
    section: 4,
    kind: 'action',
    title: 'Fund a Roth IRA up to the annual limit',
    body: 'For middle-band incomes. If late-year income or a bonus pushes you over the Roth limit, a recharacterization or backdoor conversion fixes it without penalty.',
    prerequisites: ['s4_ira_band'],
    evaluate: evaluateRothIra,
  },
  {
    id: 's4_expect_higher_income_q',
    section: 4,
    kind: 'decision',
    title: 'Will your future income likely push you above the IRA limits?',
    body: 'If yes, Roth now is generally cleaner — it avoids the pro-rata headache later. If no, the traditional deduction is worth more today.',
    prerequisites: ['s4_ira_band'],
    evaluate: evaluateExpectHigherIncomeQ,
  },
  {
    id: 's4_traditional_ira',
    section: 4,
    kind: 'action',
    title: 'Fund a traditional IRA up to the annual limit',
    body: 'Makes sense when MAGI is low today and you do not expect to outgrow the direct-contribution band later.',
    prerequisites: ['s4_expect_higher_income_q'],
    evaluate: evaluateTraditionalIra,
  },
  {
    id: 's4_solo_401k',
    section: 4,
    kind: 'info',
    title: 'Optional: park the traditional IRA inside a solo-401(k)',
    body: 'If you are self-employed (or have side income) and you keep funding a traditional IRA, opening a solo-401(k) and rolling the IRA balance into it removes the pre-tax IRA balance that would otherwise trigger pro-rata on any future backdoor conversion.',
    prerequisites: ['s4_traditional_ira'],
    evaluate: evaluateSolo401k,
  },

  // ──────────────────────────────────────────────────────────────────
  // Section 5 — Additional Tax-Advantaged Savings (8 nodes)
  // ──────────────────────────────────────────────────────────────────
  {
    id: 's5_espp_q',
    section: 5,
    kind: 'decision',
    title: 'Does your employer run an ESPP?',
    body: 'If yes, look at the plan terms. The common high-value pattern: about a 15% discount with same-day vesting, where buying and immediately selling locks in the discount as ordinary income with almost no price risk.',
    prerequisites: ['s4_backdoor_roth', 's4_roth_ira', 's4_traditional_ira'],
    evaluate: evaluateEsppQ,
  },
  {
    id: 's5_espp_action',
    section: 5,
    kind: 'action',
    title: 'Enroll in the ESPP and same-day sell',
    body: 'A safe default is to buy at the discount, sell on the first day shares are available, and route the proceeds back into your broader plan rather than letting concentrated employer stock pile up.',
    prerequisites: ['s5_espp_q'],
    evaluate: evaluateEsppAction,
  },
  {
    id: 's5_large_purchases_q',
    section: 5,
    kind: 'decision',
    title: 'Any large cash needs coming in the next three to five years?',
    body: 'Examples: tuition, a professional certification, a replacement vehicle you depend on for work, a future down payment, a planned medical procedure.',
    prerequisites: ['s5_espp_q'],
    evaluate: evaluateLargePurchasesQ,
  },
  {
    id: 's5_save_short_term',
    section: 5,
    kind: 'action',
    title: 'Pre-fund the purchase in the right vehicle',
    body: 'For generic short-term needs, a high-yield savings account is fine. For education specifically, a 529 (or a Coverdell ESA) usually wins on taxes. Under SECURE 2.0, unused 529 dollars can later be rolled to the beneficiary\'s Roth IRA up to a $35k lifetime cap, with age and account-age conditions.',
    prerequisites: ['s5_large_purchases_q'],
    evaluate: evaluateSaveShortTerm,
  },
  {
    id: 's5_employment_type_q',
    section: 5,
    kind: 'decision',
    title: 'Are you W-2 or self-employed?',
    body: 'W-2 → focus on filling up your employer 401(k). Self-employed → look at fully funding a solo-401(k) instead.',
    prerequisites: ['s5_large_purchases_q'],
    evaluate: evaluateEmploymentTypeQ,
  },
  {
    id: 's5_max_401k',
    section: 5,
    kind: 'action',
    title: 'Fill up the workplace retirement plan',
    body: 'W-2: push the 401(k) toward the annual elective-deferral cap. Self-employed: do the same with a solo-401(k), which adds an employer-side contribution on top. Pre-tax contributions are often preferred by people targeting early retirement, on the theory that withdrawals (or Roth conversions) can land in lower brackets later.',
    prerequisites: ['s5_employment_type_q'],
    evaluate: evaluateMax401k,
  },
  {
    id: 's5_prioritize_ira_vs_401k',
    section: 5,
    kind: 'info',
    title: 'If you cannot fully fund both an IRA and a 401(k), pick deliberately',
    body: 'The employer match always wins ties — never leave that on the table. Beyond that: IRAs usually have the widest fund menu and the loosest withdrawal rules; 401(k)s reduce your current-year MAGI more directly; governmental 457(b)s are unusual in that they have no 10% early-withdrawal penalty, which can make them especially valuable to early retirees.',
    prerequisites: ['s5_max_401k'],
    evaluate: evaluatePrioritizeIraVs401k,
  },

  // ──────────────────────────────────────────────────────────────────
  // Section 6 — After-Tax, Taxable, Low-Interest Loans (9 nodes)
  // ──────────────────────────────────────────────────────────────────
  {
    id: 's6_after_tax_401k_q',
    section: 6,
    kind: 'decision',
    title: 'Does your 401(k) support after-tax contributions plus in-plan Roth conversions?',
    body: 'Both features must exist in the plan document for the mega backdoor Roth to work without friction. If both are there, the next step uses them.',
    prerequisites: ['s5_prioritize_ira_vs_401k'],
    evaluate: evaluateAfterTax401kQ,
  },
  {
    id: 's6_mega_backdoor',
    section: 6,
    kind: 'action',
    title: 'Run the mega backdoor Roth (after-tax 401(k) → Roth)',
    body: 'Contribute after-tax dollars up to the combined IRS annual limit on total 401(k) contributions, then immediately convert that money to Roth inside the plan. This is a different mechanism from the regular backdoor Roth, and not every 401(k) plan permits it — read the summary plan description first.',
    prerequisites: ['s6_after_tax_401k_q'],
    evaluate: evaluateMegaBackdoor,
  },
  {
    id: 's6_529_action',
    section: 6,
    kind: 'action',
    title: 'Decide on 529 / ESA for future education',
    body: "Many states offer an income-tax deduction or credit on contributions to that state's 529 plan; the in-state plan is often the right starting point for that reason alone.",
    prerequisites: ['s6_after_tax_401k_q'],
    evaluate: evaluate529,
  },
  {
    id: 's6_taxable_brokerage',
    section: 6,
    kind: 'action',
    title: 'Save into a taxable brokerage (or prepay low-rate mortgage principal)',
    body: 'Taxable brokerage accounts have no contribution cap and allow withdrawals any time without an age penalty, which makes them the natural overflow vehicle once tax-advantaged buckets are full. Extra principal on a low-rate mortgage gives a guaranteed return equal to the loan rate — often a fine alternative when investing-return expectations are modest.',
    prerequisites: ['s6_529_action'],
    evaluate: evaluateTaxableBrokerage,
  },
  {
    id: 's6_tax_loss_harvest',
    section: 6,
    kind: 'action',
    title: 'Consider tax-loss harvesting in taxable accounts',
    body: 'Realizing a loss can offset realized gains and a small amount of ordinary income. Watch the wash-sale rule carefully — buying a substantially identical security within 30 days before or after the sale disallows the loss, and the rule applies across all of your accounts, including IRAs and your spouse\'s.',
    prerequisites: ['s6_taxable_brokerage'],
    evaluate: evaluateTaxLossHarvest,
  },
  {
    id: 's6_low_interest_debt',
    section: 6,
    kind: 'action',
    title: 'Decide whether to accelerate low-interest debt',
    body: 'In this app, a loan under 5% annual rate is treated as low-interest. The question is whether your realistic after-tax investing return beats the rate; if it does, the math favors investing the extra dollars, but the psychological comfort of being debt-free is a legitimate reason to pay it down anyway.',
    prerequisites: ['s6_tax_loss_harvest'],
    evaluate: evaluateLowInterestDebt,
  },
  {
    id: 's6_charitable_daf',
    section: 6,
    kind: 'info',
    title: 'Consider a donor-advised fund for charitable giving',
    body: 'A DAF lets you contribute several years\' worth of giving in one tax year — typically with appreciated stock to avoid capital-gains tax — take the deduction up front, and then grant the money to charities on your own schedule afterward.',
    prerequisites: ['s6_low_interest_debt'],
    evaluate: evaluateCharitableDaf,
  },
  {
    id: 's6_rebalance',
    section: 6,
    kind: 'action',
    title: 'Rebalance back to your IPS on a regular cadence',
    body: 'Pick a cadence (annually is common) or a drift threshold and stick with it. Where you can, do rebalancing inside tax-advantaged accounts, or by directing new contributions into the underweight slice, so you do not generate avoidable capital gains in taxable accounts.',
    prerequisites: ['s6_charitable_daf'],
    evaluate: evaluateRebalance,
  },
];

export function nodeById(id: NodeId): RoadmapNode | undefined {
  return NODES.find((n) => n.id === id);
}
