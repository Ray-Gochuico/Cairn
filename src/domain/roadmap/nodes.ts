import type { NodeId, NodeResult, RoadmapContext, RoadmapNode } from '@/types/roadmap';

/**
 * Declarative registry of every Roadmap chart node, derived from
 * FinFlowChartv43.md sections 0–6. Sub-Plan B ships the skeleton: all
 * ~49 IDs registered with stub evaluators that return an 'info' status
 * + "not yet implemented" evidence. Three rules (emergencyFund,
 * debtClassification, iraBranch) replace specific stubs in Tasks 7-9.
 * Sub-Plan C fills in the rest incrementally as each rule is needed.
 *
 * Node IDs use the pattern `s<section>_<short_name>`. They are stable
 * identifiers — never renamed once shipped, because they're the foreign
 * key in roadmap_node_overrides.
 */

// Stub evaluator factory — every node starts here, three get replaced.
const stub = (id: NodeId) =>
  (_ctx: RoadmapContext): NodeResult => ({
    status: 'info',
    evidence: `Evaluator for "${id}" not yet implemented`,
  });

export const NODES: ReadonlyArray<RoadmapNode> = [
  // ──────────────────────────────────────────────────────────────────
  // Section 0 — Budget & Essentials (7 action nodes, linear)
  // ──────────────────────────────────────────────────────────────────
  {
    id: 's0_create_budget',
    section: 0,
    kind: 'action',
    title: 'Create a budget',
    body: 'Knowing where your money goes is the foundation. Budgeting shows your income less your expenses.',
    prerequisites: [],
    evaluate: stub('s0_create_budget'),
  },
  {
    id: 's0_pay_rent',
    section: 0,
    kind: 'action',
    title: 'Pay rent / mortgage',
    body: 'Include renters or homeowners insurance if required.',
    prerequisites: ['s0_create_budget'],
    evaluate: stub('s0_pay_rent'),
  },
  {
    id: 's0_buy_food',
    section: 0,
    kind: 'action',
    title: 'Buy food / groceries',
    body: 'Depending on your situation you may want to prioritize utilities before this step.',
    prerequisites: ['s0_pay_rent'],
    evaluate: stub('s0_buy_food'),
  },
  {
    id: 's0_pay_essentials',
    section: 0,
    kind: 'action',
    title: 'Pay essential items',
    body: 'Utilities, power, water, heat, toiletries, etc.',
    prerequisites: ['s0_buy_food'],
    evaluate: stub('s0_pay_essentials'),
  },
  {
    id: 's0_income_expenses',
    section: 0,
    kind: 'action',
    title: 'Pay income-earning expenses',
    body: 'Transportation, possibly internet/phone — anything required to keep earning income.',
    prerequisites: ['s0_pay_essentials'],
    evaluate: stub('s0_income_expenses'),
  },
  {
    id: 's0_pay_health_care',
    section: 0,
    kind: 'action',
    title: 'Pay health care',
    body: 'Health insurance and health care expenses.',
    prerequisites: ['s0_income_expenses'],
    evaluate: stub('s0_pay_health_care'),
  },
  {
    id: 's0_min_debt_payments',
    section: 0,
    kind: 'action',
    title: 'Make minimum payments on all debts and loans',
    body: 'Student loans, credit cards, etc. Avoid delinquency before optimizing anything else.',
    prerequisites: ['s0_pay_health_care'],
    evaluate: stub('s0_min_debt_payments'),
  },

  // ──────────────────────────────────────────────────────────────────
  // Section 1 — Employer Match & Emergency Fund (8 nodes)
  // ──────────────────────────────────────────────────────────────────
  {
    id: 's1_emergency_small',
    section: 1,
    kind: 'action',
    title: 'Build a small emergency fund',
    body: '$1,000 or one month of expenses, whichever is greater. Park it in a high-yield savings account (HYSA).',
    prerequisites: ['s0_min_debt_payments'],
    evaluate: stub('s1_emergency_small'),
  },
  {
    id: 's1_evaluate_non_essentials',
    section: 1,
    kind: 'action',
    title: 'Evaluate your non-essentials',
    body: 'Reduce expenses where you can; otherwise pay non-essential bills in full (cable, internet, phone, etc.).',
    prerequisites: ['s1_emergency_small'],
    evaluate: stub('s1_evaluate_non_essentials'),
  },
  {
    id: 's1_track_expenses',
    section: 1,
    kind: 'action',
    title: 'Track all your expenses',
    body: 'This shows where money is going and where to cut.',
    prerequisites: ['s1_evaluate_non_essentials'],
    evaluate: stub('s1_track_expenses'),
  },
  {
    id: 's1_consider_ips',
    section: 1,
    kind: 'info',
    title: 'Consider writing an Investment Policy Statement (IPS)',
    body: 'An IPS records your investing rules in advance so you do not improvise during market stress.',
    prerequisites: ['s1_track_expenses'],
    evaluate: stub('s1_consider_ips'),
  },
  {
    id: 's1_employer_match_q',
    section: 1,
    kind: 'decision',
    title: 'Does your employer offer a retirement account with a match?',
    body: 'Yes → contribute exactly the amount needed to capture the full match. No → skip ahead.',
    prerequisites: ['s1_consider_ips'],
    evaluate: stub('s1_employer_match_q'),
  },
  {
    id: 's1_employer_match',
    section: 1,
    kind: 'action',
    title: 'Capture the full employer match',
    body: 'Contribute exactly the amount needed to capture the full match — and nothing more at this stage.',
    prerequisites: ['s1_employer_match_q'],
    evaluate: stub('s1_employer_match'),
  },
  {
    id: 's1_high_interest_debt',
    section: 1,
    kind: 'action',
    title: 'Pay all high-interest debt',
    body: 'Defined in this app as any loan with an annual rate ≥ 8% (default; adjustable in Settings → Advanced).',
    prerequisites: ['s1_employer_match'],
    evaluate: stub('s1_high_interest_debt'),
  },
  {
    id: 's1_job_stability_q',
    section: 1,
    kind: 'decision',
    title: 'Stable or unstable job prospects?',
    body: 'Stable → grow EF to 3 months. Unstable → grow to 6–12 months.',
    prerequisites: ['s1_high_interest_debt'],
    evaluate: stub('s1_job_stability_q'),
  },
  {
    id: 's1_emergency_3mo',
    section: 1,
    kind: 'action',
    title: 'Grow EF to 3 months (stable income)',
    body: 'Use an FDIC-insured HYSA, low-risk brokerage assets, or a mix.',
    prerequisites: ['s1_job_stability_q'],
    evaluate: stub('s1_emergency_3mo'),
  },
  {
    id: 's1_emergency_6_12mo',
    section: 1,
    kind: 'action',
    title: 'Grow EF to 6–12 months (unstable income)',
    body: 'Use an FDIC-insured HYSA or a rotating CD ladder sized to monthly expenses.',
    prerequisites: ['s1_job_stability_q'],
    evaluate: stub('s1_emergency_6_12mo'),
  },

  // ──────────────────────────────────────────────────────────────────
  // Section 2 — Debt Reduction (2 nodes)
  // ──────────────────────────────────────────────────────────────────
  {
    id: 's2_moderate_debt_q',
    section: 2,
    kind: 'decision',
    title: 'Do you have any moderate-interest debt?',
    body: 'Defined as any loan with an annual rate between 5% and 8% (default; adjustable).',
    prerequisites: ['s1_emergency_3mo', 's1_emergency_6_12mo'],
    evaluate: stub('s2_moderate_debt_q'),
  },
  {
    id: 's2_moderate_debt_action',
    section: 2,
    kind: 'action',
    title: 'Refinance + avalanche moderate-interest debt',
    body: 'Refinance the rate down where possible, then pay the highest-rate balance first (avalanche).',
    prerequisites: ['s2_moderate_debt_q'],
    evaluate: stub('s2_moderate_debt_action'),
  },

  // ──────────────────────────────────────────────────────────────────
  // Section 3 — HSA (7 nodes)
  // ──────────────────────────────────────────────────────────────────
  {
    id: 's3_pick_medical_insurance',
    section: 3,
    kind: 'action',
    title: 'Pick the right medical insurance for your needs',
    body: 'PPO / POS / HMO / EPO each have different premiums, deductibles, and copays. If under 26 and parent plan eligible, compare that too.',
    prerequisites: ['s2_moderate_debt_action'],
    evaluate: stub('s3_pick_medical_insurance'),
  },
  {
    id: 's3_hdhp_q',
    section: 3,
    kind: 'decision',
    title: 'Do you have an HSA-qualified HDHP?',
    body: 'No → skip to Section 4. Yes → continue with HSA contributions.',
    prerequisites: ['s3_pick_medical_insurance'],
    evaluate: stub('s3_hdhp_q'),
  },
  {
    id: 's3_contribute_hsa',
    section: 3,
    kind: 'action',
    title: 'Contribute to an HSA',
    body: 'Contributing through your employer makes it FICA-deductible too. HDHP+HSA is generally recommended if you are relatively healthy.',
    prerequisites: ['s3_hdhp_q'],
    evaluate: stub('s3_contribute_hsa'),
  },
  {
    id: 's3_save_receipts',
    section: 3,
    kind: 'action',
    title: 'Keep proof of purchase for qualified medical expenses',
    body: 'Build a receipts system — HSAs let you reimburse yourself years later from those receipts.',
    prerequisites: ['s3_contribute_hsa'],
    evaluate: stub('s3_save_receipts'),
  },
  {
    id: 's3_hsa_fees_q',
    section: 3,
    kind: 'decision',
    title: 'Does your employer HSA have high fees?',
    body: 'Yes → roll the balance to a lower-fee HSA brokerage if available. No → keep contributing there.',
    prerequisites: ['s3_save_receipts'],
    evaluate: stub('s3_hsa_fees_q'),
  },
  {
    id: 's3_rollover_hsa',
    section: 3,
    kind: 'action',
    title: 'Roll HSA balance to a lower-fee HSA brokerage',
    body: 'Most HSA custodians allow trustee-to-trustee transfers without tax consequences.',
    prerequisites: ['s3_hsa_fees_q'],
    evaluate: stub('s3_rollover_hsa'),
  },
  {
    id: 's3_keep_employer_hsa',
    section: 3,
    kind: 'info',
    title: 'Keep contributing to employer HSA + enroll in investing',
    body: 'Once you hit the minimum cash threshold, switch additional contributions into the investing portion.',
    prerequisites: ['s3_hsa_fees_q'],
    evaluate: stub('s3_keep_employer_hsa'),
  },

  // ──────────────────────────────────────────────────────────────────
  // Section 4 — IRA (8 nodes)
  // ──────────────────────────────────────────────────────────────────
  {
    id: 's4_earned_income_q',
    section: 4,
    kind: 'decision',
    title: 'Do you have earned income?',
    body: 'Required for any IRA contribution. Before April 15, you can also still fund last year.',
    prerequisites: ['s3_rollover_hsa', 's3_keep_employer_hsa'],
    evaluate: stub('s4_earned_income_q'),
  },
  {
    id: 's4_contribute_ira',
    section: 4,
    kind: 'action',
    title: 'Contribute to an IRA',
    body: 'Then calculate your Modified Adjusted Gross Income (MAGI) to pick the right branch.',
    prerequisites: ['s4_earned_income_q'],
    evaluate: stub('s4_contribute_ira'),
  },
  {
    id: 's4_ira_band',
    section: 4,
    kind: 'info',
    title: 'Branch by MAGI',
    body: 'Single MAGI > $153k or MFJ > $242k → backdoor Roth. Single $81k–$153k or MFJ $129k–$242k → Roth IRA. Below → step 4 (traditional vs. Roth choice).',
    prerequisites: ['s4_contribute_ira'],
    evaluate: stub('s4_ira_band'),
  },
  {
    id: 's4_backdoor_roth',
    section: 4,
    kind: 'action',
    title: 'Max traditional IRA, then convert to Roth (backdoor)',
    body: 'High earners only. Be aware of the IRS pro-rata rule if you hold any pre-tax IRA balance.',
    prerequisites: ['s4_ira_band'],
    evaluate: stub('s4_backdoor_roth'),
  },
  {
    id: 's4_roth_ira',
    section: 4,
    kind: 'action',
    title: 'Max out Roth IRA',
    body: 'Mid-band earners. If you accidentally over-contribute, perform a recharacterization.',
    prerequisites: ['s4_ira_band'],
    evaluate: stub('s4_roth_ira'),
  },
  {
    id: 's4_expect_higher_income_q',
    section: 4,
    kind: 'decision',
    title: 'Do you expect future income to exceed the IRS threshold?',
    body: 'Yes → consider Roth (avoid pro-rata pain later). No → max traditional for current deduction.',
    prerequisites: ['s4_ira_band'],
    evaluate: stub('s4_expect_higher_income_q'),
  },
  {
    id: 's4_traditional_ira',
    section: 4,
    kind: 'action',
    title: 'Max out traditional IRA',
    body: 'For low-MAGI filers not expecting higher future income.',
    prerequisites: ['s4_expect_higher_income_q'],
    evaluate: stub('s4_traditional_ira'),
  },
  {
    id: 's4_solo_401k',
    section: 4,
    kind: 'info',
    title: 'Consider rolling tIRA → solo-401(k) to sidestep pro-rata',
    body: 'If you still go with a traditional IRA, opening a solo-401(k) and rolling the tIRA in avoids future backdoor pro-rata pain.',
    prerequisites: ['s4_traditional_ira'],
    evaluate: stub('s4_solo_401k'),
  },

  // ──────────────────────────────────────────────────────────────────
  // Section 5 — Additional Tax-Advantaged Savings (8 nodes)
  // ──────────────────────────────────────────────────────────────────
  {
    id: 's5_espp_q',
    section: 5,
    kind: 'decision',
    title: 'Does your employer offer an ESPP?',
    body: 'Yes → evaluate participating. A common good case: 15% discount + immediate vesting — buy and sell immediately.',
    prerequisites: ['s4_backdoor_roth', 's4_roth_ira', 's4_traditional_ira'],
    evaluate: stub('s5_espp_q'),
  },
  {
    id: 's5_espp_action',
    section: 5,
    kind: 'action',
    title: 'Participate in ESPP',
    body: 'Default play: buy at the discounted price, sell immediately to lock the spread, redirect proceeds back into your plan.',
    prerequisites: ['s5_espp_q'],
    evaluate: stub('s5_espp_action'),
  },
  {
    id: 's5_large_purchases_q',
    section: 5,
    kind: 'decision',
    title: 'Any large required purchases in the next 3–5 years?',
    body: 'College, certifications, a car needed for work, a future house, etc.',
    prerequisites: ['s5_espp_q'],
    evaluate: stub('s5_large_purchases_q'),
  },
  {
    id: 's5_save_short_term',
    section: 5,
    kind: 'action',
    title: 'Save the upcoming-purchase amount in HYSA / 529 / ESA',
    body: 'For educational expenses, prefer a 529 or Coverdell ESA. SECURE 2.0 also permits a 529 → Roth IRA rollover (lifetime $35k cap).',
    prerequisites: ['s5_large_purchases_q'],
    evaluate: stub('s5_save_short_term'),
  },
  {
    id: 's5_employment_type_q',
    section: 5,
    kind: 'decision',
    title: 'W-2 employee or self-employed?',
    body: 'W-2 → finish maxing employer 401(k). Self-employed → evaluate maxing a solo-401(k).',
    prerequisites: ['s5_large_purchases_q'],
    evaluate: stub('s5_employment_type_q'),
  },
  {
    id: 's5_max_401k',
    section: 5,
    kind: 'action',
    title: 'Finish maxing your employer plan (401(k) or solo-401(k))',
    body: 'W-2 → finish maxing the employer 401(k). Self-employed → max a solo-401(k). Many on the FIRE path prefer pre-tax, then convert/withdraw in lower-bracket years.',
    prerequisites: ['s5_employment_type_q'],
    evaluate: stub('s5_max_401k'),
  },
  {
    id: 's5_prioritize_ira_vs_401k',
    section: 5,
    kind: 'info',
    title: 'IRA vs. 401(k) priority (when you cannot max both)',
    body: 'Always capture the employer match first. IRAs offer more flexibility; 401(k)s lower MAGI; 457(b)s have no 10% early-withdrawal penalty.',
    prerequisites: ['s5_max_401k'],
    evaluate: stub('s5_prioritize_ira_vs_401k'),
  },

  // ──────────────────────────────────────────────────────────────────
  // Section 6 — After-Tax, Taxable, Low-Interest Loans (9 nodes)
  // ──────────────────────────────────────────────────────────────────
  {
    id: 's6_after_tax_401k_q',
    section: 6,
    kind: 'decision',
    title: 'Does your 401(k) allow after-tax + in-plan Roth rollover?',
    body: 'Yes → execute the "mega backdoor Roth" up to the $66k combined limit.',
    prerequisites: ['s5_prioritize_ira_vs_401k'],
    evaluate: stub('s6_after_tax_401k_q'),
  },
  {
    id: 's6_mega_backdoor',
    section: 6,
    kind: 'action',
    title: 'Max after-tax 401(k) and roll into Roth (mega backdoor)',
    body: 'Distinct from the regular backdoor Roth. Availability depends on plan documents.',
    prerequisites: ['s6_after_tax_401k_q'],
    evaluate: stub('s6_mega_backdoor'),
  },
  {
    id: 's6_529_action',
    section: 6,
    kind: 'action',
    title: 'Evaluate 529 / ESA for future generations',
    body: "Check your state's 529 for state-tax deductions.",
    prerequisites: ['s6_after_tax_401k_q'],
    evaluate: stub('s6_529_action'),
  },
  {
    id: 's6_taxable_brokerage',
    section: 6,
    kind: 'action',
    title: 'Contribute to a taxable brokerage (or pay extra mortgage principal)',
    body: 'A taxable account has zero contribution cap and flexible access; extra mortgage principal compounds via avoided interest.',
    prerequisites: ['s6_529_action'],
    evaluate: stub('s6_taxable_brokerage'),
  },
  {
    id: 's6_tax_loss_harvest',
    section: 6,
    kind: 'action',
    title: 'Evaluate tax-loss harvesting',
    body: 'Watch the wash-sale rule (30 days across all your accounts, including IRAs).',
    prerequisites: ['s6_taxable_brokerage'],
    evaluate: stub('s6_tax_loss_harvest'),
  },
  {
    id: 's6_low_interest_debt',
    section: 6,
    kind: 'action',
    title: 'Evaluate paying off low-interest debt',
    body: 'Defined as any loan with an annual rate < 5%. Compare your expected after-tax return on investments to the rate.',
    prerequisites: ['s6_tax_loss_harvest'],
    evaluate: stub('s6_low_interest_debt'),
  },
  {
    id: 's6_charitable_daf',
    section: 6,
    kind: 'info',
    title: 'Consider a donor-advised fund (DAF) for charitable giving',
    body: 'Front-loads multiple years of deductions into a single tax year via appreciated-stock contributions.',
    prerequisites: ['s6_low_interest_debt'],
    evaluate: stub('s6_charitable_daf'),
  },
  {
    id: 's6_rebalance',
    section: 6,
    kind: 'action',
    title: 'Rebalance your portfolio to your IPS regularly',
    body: 'Minimize fees and avoid generating taxable events when possible (e.g. rebalance via new contributions, not sells).',
    prerequisites: ['s6_charitable_daf'],
    evaluate: stub('s6_rebalance'),
  },
];

export function nodeById(id: NodeId): RoadmapNode | undefined {
  return NODES.find((n) => n.id === id);
}
