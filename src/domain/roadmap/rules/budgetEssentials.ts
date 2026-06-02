import type { NodeResult, RoadmapContext } from '@/types/roadmap';

/**
 * Section 0 — Budget & Essentials.
 *
 * The chart's first section is "do the basics" — every household does
 * these things in some form, so the app doesn't try to verify them
 * (no insurance policy parser, no utility-bill scanner). What we *can*
 * do is confirm the user has at least set up a monthly expense baseline,
 * which is the single load-bearing input the rest of the roadmap reads.
 *
 * Status convention here:
 *   - `s0_create_budget` is the one node with a real signal:
 *     `monthlyExpenseBaseline > 0` flips it to `done`. Otherwise it is
 *     `active` and points at the household form.
 *   - The other six nodes are `info` — they exist so the user sees the
 *     full list and recognizes the framework, not because the engine
 *     can score them. They mirror the chart's prose.
 *
 * This is deliberately conservative. We'd rather show "info" than fake
 * a "done" check on something we can't observe; the spec calls the
 * roadmap educational, not auditing.
 */

export function evaluateCreateBudget(ctx: RoadmapContext): NodeResult {
  const baseline = ctx.household.monthlyExpenseBaseline;
  if (baseline > 0) {
    return {
      status: 'done',
      evidence: `Monthly expense baseline set ($${Math.round(baseline).toLocaleString('en-US')}/mo)`,
    };
  }
  return {
    status: 'active',
    evidence: 'Set your monthly expense baseline in Household to anchor the rest of the Roadmap',
    cta: { label: 'Open Household →', href: '/inputs/household' },
  };
}

const INFO_EVIDENCE: Record<string, string> = {
  s0_pay_rent: 'Cover rent or mortgage first (include renters/homeowners insurance if required).',
  s0_buy_food: 'Groceries come next. Utilities may take precedence depending on your situation.',
  s0_pay_essentials: 'Utilities, power, water, heat, basic toiletries.',
  s0_income_expenses: 'Transportation and tools required to keep earning income.',
  s0_pay_health_care: 'Health insurance + recurring health-care expenses.',
  s0_min_debt_payments: 'Minimum payments on every debt to avoid delinquency before optimizing.',
};

export function evaluateSection0Info(id: keyof typeof INFO_EVIDENCE) {
  return (_ctx: RoadmapContext): NodeResult => ({
    status: 'info',
    evidence: INFO_EVIDENCE[id],
  });
}
