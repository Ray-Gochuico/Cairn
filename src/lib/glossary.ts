/**
 * Glossary — single source of truth for the financial terms the UI uses.
 *
 * Per user directive, the app keeps the *proper* names (DCFSA, SWR, Coast FI,
 * MFJ, NIIT, etc.) — no rename pass. The friction this used to create for
 * non-financial friends is closed by wrapping each term in a `<TermTooltip>`,
 * which surfaces the definition below on hover or tap.
 *
 * Adding a new term: add one entry here, then wrap its appearance in
 * `<TermTooltip term="MY_TERM">...</TermTooltip>`. The renderer reads
 * `shortDefinition` first; if `fullDefinition` is present, the popover shows
 * it; otherwise it falls back to the short text alone.
 */

export interface GlossaryEntry {
  /** Canonical key — UPPER_SNAKE_CASE / matches the on-screen label. */
  term: string;
  /** One-sentence definition. Always shown. */
  shortDefinition: string;
  /** Optional longer explanation displayed beneath the short one. */
  fullDefinition?: string;
  /** Optional concrete examples shown as bullets. */
  examples?: string[];
  /** Optional link to a friendly external explainer (e.g., investopedia). */
  learnMoreUrl?: string;
}

/**
 * Lookup map. Keys are case-sensitive; we resolve case at the consumer side
 * (`getGlossaryEntry`) so callers can write `<TermTooltip term="dcfsa">`
 * or `"DCFSA"` interchangeably.
 */
export const GLOSSARY: Record<string, GlossaryEntry> = {
  // ─── Health & dependent care ──────────────────────────────────────────
  DCFSA: {
    term: 'DCFSA',
    shortDefinition: 'Dependent Care FSA — pre-tax money set aside for childcare or eldercare.',
    fullDefinition:
      'A workplace account that lets you contribute pre-tax dollars (up to ~$5,000 / year) for qualified childcare or eldercare expenses, lowering your taxable income.',
    examples: ['Daycare', 'After-school programs', 'Summer day camp', 'Adult day care'],
  },
  FSA: {
    term: 'FSA',
    shortDefinition: 'Flexible Spending Account — pre-tax money for medical expenses.',
    fullDefinition:
      'A workplace account where you set aside pre-tax money to spend on medical costs. Use-it-or-lose-it within the year (with a small carry-over allowance).',
  },
  HSA: {
    term: 'HSA',
    shortDefinition:
      'Health Savings Account — triple-tax-advantaged account for medical expenses, only if you have an HDHP.',
    fullDefinition:
      'Contributions reduce taxable income, growth is tax-free, and qualified withdrawals are tax-free. Unlike an FSA, the balance rolls over forever and you keep it if you switch jobs.',
  },
  HDHP: {
    term: 'HDHP',
    shortDefinition: 'High-Deductible Health Plan — required to contribute to an HSA.',
    fullDefinition:
      'A health insurance plan with a higher deductible (you pay more out of pocket before insurance kicks in) but typically lower premiums. Being enrolled in an HDHP is what lets you open and fund an HSA.',
  },

  // ─── Payroll taxes ────────────────────────────────────────────────────
  FICA: {
    term: 'FICA',
    shortDefinition:
      'Federal Insurance Contributions Act — the payroll tax that funds Social Security and Medicare.',
    fullDefinition:
      'Roughly 7.65% of your wages: 6.2% Social Security (capped at the annual wage base) + 1.45% Medicare (uncapped). Your employer pays a matching amount.',
  },
  'SS WAGE BASE': {
    term: 'SS wage base',
    shortDefinition:
      'The annual wage cap above which the 6.2% Social Security portion of FICA no longer applies.',
    fullDefinition:
      'Indexed each year. Earnings above the wage base still owe Medicare and federal/state income tax, but the Social Security portion stops.',
  },
  'MEDICARE SURTAX': {
    term: 'Medicare surtax',
    shortDefinition:
      'An extra 0.9% Medicare tax on wages above $200k (single) / $250k (MFJ).',
  },
  NIIT: {
    term: 'NIIT',
    shortDefinition:
      'Net Investment Income Tax — an extra 3.8% tax on investment income above ~$200k (single) / $250k (MFJ).',
    fullDefinition:
      'Applies to interest, dividends, capital gains, and rental income once your modified AGI crosses the threshold.',
  },

  // ─── Retirement & FI concepts ─────────────────────────────────────────
  SWR: {
    term: 'SWR',
    shortDefinition:
      'Safe Withdrawal Rate — the percentage of your portfolio you can withdraw each year and (probably) not run out.',
    fullDefinition:
      'The famous "4% rule" (Bengen / Trinity Study) says ~4% of your starting nest egg, inflation-adjusted thereafter, has historically lasted a 30-year retirement. Lower rates are more conservative.',
  },
  'COAST FI': {
    term: 'Coast FI',
    shortDefinition:
      'The point where your existing investments will grow into a full retirement nest egg on their own — even if you stop contributing.',
    fullDefinition:
      'You still need to cover current expenses, but you no longer need to save for retirement. A common milestone on the way to full Financial Independence.',
  },
  FIRE: {
    term: 'FIRE',
    shortDefinition:
      'Financial Independence, Retire Early — a movement around saving aggressively to reach FI well before traditional retirement age.',
  },
  FI: {
    term: 'FI',
    shortDefinition:
      'Financial Independence — your investments throw off enough income to cover your expenses, so work becomes optional.',
    fullDefinition:
      'Rule of thumb: ~25× your annual expenses, assuming a 4% safe withdrawal rate.',
  },
  '401(K)': {
    term: '401(k)',
    shortDefinition: 'A workplace retirement plan you contribute to from your paycheck.',
    fullDefinition:
      'Pre-tax contributions reduce your taxable income now; growth is tax-deferred; you owe income tax on withdrawals in retirement. Many employers also match a percentage. The Roth variant is post-tax in / tax-free out.',
  },
  'ROTH IRA': {
    term: 'Roth IRA',
    shortDefinition:
      'An Individual Retirement Account funded with after-tax dollars — withdrawals in retirement are tax-free.',
    fullDefinition:
      'Annual contribution cap (~$7,000 / yr in 2026, higher if 50+); income-limited (phases out at higher MAGI but the Backdoor Roth conversion route is available).',
  },
  'TRADITIONAL IRA': {
    term: 'Traditional IRA',
    shortDefinition:
      'An Individual Retirement Account funded with pre-tax dollars — withdrawals in retirement are taxed as ordinary income.',
  },
  '529 PLAN': {
    term: '529 plan',
    shortDefinition: 'A tax-advantaged account for college and K-12 education savings.',
    fullDefinition:
      'Contributions grow tax-free; withdrawals for qualified education expenses are tax-free. Many states also give a state-income-tax deduction on contributions to their own plan.',
  },
  RMD: {
    term: 'RMD',
    shortDefinition:
      'Required Minimum Distribution — the amount the IRS forces you to withdraw from pre-tax retirement accounts starting at age 73.',
  },

  // ─── Filing status & deductions ───────────────────────────────────────
  MFJ: {
    term: 'MFJ',
    shortDefinition: 'Married Filing Jointly — one combined federal tax return for a married couple.',
  },
  MFS: {
    term: 'MFS',
    shortDefinition: 'Married Filing Separately — each spouse files their own return.',
  },
  HOH: {
    term: 'HOH',
    shortDefinition:
      'Head of Household — unmarried filer who pays >half the cost of keeping a home for a qualifying dependent.',
  },
  AMT: {
    term: 'AMT',
    shortDefinition:
      'Alternative Minimum Tax — a parallel tax calculation that ensures high-income filers pay at least a minimum amount.',
    fullDefinition:
      'Mostly affects households with large ISO exercises, big SALT deductions, or large pre-tax incentives. You owe the higher of the regular tax and the AMT.',
  },
  'STANDARD DEDUCTION': {
    term: 'standard deduction',
    shortDefinition:
      'A fixed dollar amount the IRS lets you subtract from your income before calculating tax, instead of itemizing.',
  },

  // ─── Equity compensation ─────────────────────────────────────────────
  ISO: {
    term: 'ISO',
    shortDefinition:
      'Incentive Stock Option — a type of employee stock option with favorable tax treatment if held long enough.',
    fullDefinition:
      'Exercise creates no ordinary income tax (but can trigger AMT). Hold for 1 yr post-exercise + 2 yrs post-grant to qualify for long-term capital gains treatment on the whole spread.',
  },
  RSU: {
    term: 'RSU',
    shortDefinition: 'Restricted Stock Unit — company shares that vest to you over time.',
    fullDefinition:
      'Vested RSUs are taxed as ordinary income at the fair market value on the vest date. Any gain after vesting is capital-gains.',
  },
  ESPP: {
    term: 'ESPP',
    shortDefinition:
      'Employee Stock Purchase Plan — buy your employer\'s shares at a discount through payroll deductions.',
    fullDefinition:
      'Typical discount is 5–15% off the lower of the start-of-period and end-of-period share price ("lookback"). Sale tax treatment depends on holding period.',
  },
  'COST BASIS': {
    term: 'cost basis',
    shortDefinition: 'What you paid for an investment — used to calculate capital gain or loss when you sell.',
  },
  VESTING: {
    term: 'vesting',
    shortDefinition:
      'The process of earning equity over time — typically 4-year vests with a 1-year cliff.',
  },

  // ─── Tax brackets & rates ────────────────────────────────────────────
  'MARGINAL RATE': {
    term: 'marginal rate',
    shortDefinition: 'The tax rate on your next dollar of income — your highest bracket.',
  },
  'EFFECTIVE RATE': {
    term: 'effective rate',
    shortDefinition: 'Your total tax divided by your total income — your blended overall rate.',
  },
  'QUALIFIED DIVIDEND': {
    term: 'qualified dividend',
    shortDefinition:
      'A dividend taxed at the lower long-term capital gains rate instead of as ordinary income.',
    fullDefinition:
      'Generally requires the dividend to come from a U.S. corp or qualifying foreign corp, held >60 days around the ex-dividend date.',
  },
  LTCG: {
    term: 'LTCG',
    shortDefinition:
      'Long-Term Capital Gains — gains on investments held >1 year, taxed at preferential rates (0% / 15% / 20%).',
  },

  // ─── Investment concepts ─────────────────────────────────────────────
  DRIFT: {
    term: 'drift',
    shortDefinition:
      'How far your portfolio\'s actual mix has wandered from your target allocation as markets move.',
    fullDefinition:
      'Example: target 60% stocks / 40% bonds. After a strong year, stocks are 70% — that\'s 10 points of drift. Rebalancing pulls you back to the target.',
  },
  CONCENTRATION: {
    term: 'concentration',
    shortDefinition:
      'How much of your wealth is in a single holding — high concentration = high single-stock risk.',
  },
  CAP: {
    term: 'cap',
    shortDefinition:
      'A concentration limit you set — alerts you when any single holding exceeds this share of the portfolio.',
  },
  'EXPENSE BASELINE': {
    term: 'expense baseline',
    shortDefinition:
      'Your typical monthly spending — anchors the FI / Coast FI calculations.',
  },
  'TAX BUCKET': {
    term: 'tax bucket',
    shortDefinition:
      'A grouping of accounts by tax treatment: pre-tax (401k, traditional IRA), Roth (Roth IRA / Roth 401k), and taxable (brokerage).',
    fullDefinition:
      'Mixing buckets matters in retirement: pre-tax withdrawals are taxed as income, Roth is tax-free, and taxable enjoys LTCG rates.',
  },

  // ─── Retirement drawdown strategy ─────────────────────────────────────
  'SEQUENTIAL WITHDRAWAL': {
    term: 'sequential withdrawal',
    shortDefinition:
      'A retirement drawdown order: drain taxable brokerage first, then pre-tax (401k/IRA), then Roth last.',
    fullDefinition:
      'Textbook tax-efficient sequencing — keeps tax-advantaged accounts compounding longer and gives more room for Roth-conversion-ladder planning. The alternative is proportional withdrawal, which pulls from every account in proportion to balance.',
  },
  'DRAWDOWN TAX RATE': {
    term: 'Drawdown tax rate',
    shortDefinition:
      'Blended federal + FICA + state effective tax rate the projection applies to pre-tax (Trad 401k/IRA) withdrawals during retirement.',
    fullDefinition:
      'Pre-tax retirement balances are taxed as ordinary income when withdrawn — a $60k/yr expense needs ~$77k of gross Trad withdrawals at a 22% effective rate. Without this gross-up, the projection silently over-states ending balances for Trad-heavy retirees by tens of thousands per year. Applies only when a What-If scenario uses the "sequential" withdrawal strategy.',
  },

  // ─── Calculator + paycheck terms ──────────────────────────────────────
  'PRETAX 401(K)': {
    term: 'Pretax 401(k)',
    shortDefinition:
      'The portion of your paycheck routed into a traditional 401(k) before income tax is withheld.',
    fullDefinition:
      'Lowers your taxable income now; the money + growth are taxed as ordinary income when you withdraw in retirement.',
  },
  'PRETAX DCFSA': {
    term: 'Pretax DCFSA',
    shortDefinition:
      'The portion of your paycheck routed into a Dependent Care FSA before tax is withheld — used for daycare, summer camp, etc.',
  },
  'PRETAX HSA': {
    term: 'Pretax HSA',
    shortDefinition:
      'The portion of your paycheck routed into a Health Savings Account before tax is withheld (HDHP enrollees only).',
  },
  'EARLY-WITHDRAWAL PENALTY': {
    term: 'Early-withdrawal penalty',
    shortDefinition:
      'An extra 10% federal tax on retirement-account withdrawals taken before age 59½.',
    fullDefinition:
      'Applies on top of regular income tax. Limited exceptions exist (separation from service at 55, hardship, SEPP/72(t)) but the default rule is: < 59½ → +10%.',
  },
  AGI: {
    term: 'AGI',
    shortDefinition:
      'Adjusted Gross Income — your total income minus a handful of above-the-line deductions (401k, HSA, etc.).',
  },
  MAGI: {
    term: 'MAGI',
    shortDefinition:
      'Modified AGI — your AGI plus a few add-backs (foreign-earned-income exclusion, etc.). Used as the threshold for Roth IRA contributions, NIIT, IRMAA, etc.',
  },

  // ─── What-If chart / lever copy ───────────────────────────────────────
  SURPLUS: {
    term: 'Surplus (gap)',
    shortDefinition:
      "Money left over each month after expenses and loan payments — what's available to invest or save.",
    fullDefinition:
      'Sometimes called "the gap" — gap allocation routes this surplus into tax-advantaged accounts, brokerage, and/or cash.',
  },
  'DROP DEAD BASELINE': {
    term: 'Drop dead baseline',
    shortDefinition:
      "Your minimum monthly spending — what you'd cut to if income disappeared (rent, food, utilities, healthcare).",
    fullDefinition:
      'The floor used in worst-case scenario modelling. Useful for deciding how much liquid cash counts as an emergency fund.',
  },
  'SALARY TRAJECTORY': {
    term: 'Salary trajectory',
    shortDefinition:
      'Your projected year-over-year salary path including raises, promotions, job changes, and any sabbatical or cut events.',
  },
  'PER ACCOUNT': {
    term: 'Per account',
    shortDefinition:
      "A projection chart detail mode that draws one line per investment account, so you can see each account's trajectory separately.",
  },
  'NOMINAL VS REAL': {
    term: 'Nominal vs Real',
    shortDefinition:
      'Nominal dollars are today\'s sticker amounts; real dollars discount future amounts back to today\'s purchasing power using inflation.',
  },
  NOMINAL: {
    term: 'Nominal',
    shortDefinition:
      'Sticker-price dollars — what a number says without adjusting for inflation.',
    fullDefinition:
      'Nominal mode shows future projections in raw future dollars. Useful for "what will the account balance read" questions, but a $1M nominal balance in 30 years buys far less than $1M today.',
  },
  REAL: {
    term: 'Real',
    shortDefinition:
      "Today's-dollar amounts — future projections discounted back using your inflation assumption so they're comparable to today's prices.",
    fullDefinition:
      'Real mode shows what a future balance is worth in today\'s purchasing power. Better for "can I retire on this?" planning since expenses also tend to move with inflation.',
  },
  SINGLE: {
    term: 'Single',
    shortDefinition:
      'A projection chart detail mode that draws one line for total investments — no breakdown by tax treatment or account.',
    fullDefinition:
      'The simplest view. Use Tax bucket to split into pre-tax / Roth / taxable, or Per account to see each account separately.',
  },

  // ─── Settings: Advanced ───────────────────────────────────────────────
  APY: {
    term: 'APY',
    shortDefinition:
      'Annual Percentage Yield — the effective annual return after compounding is applied. Use this (not APR) when comparing savings/CD rates.',
  },
  'COMPOUNDING FREQUENCY': {
    term: 'Compounding frequency',
    shortDefinition:
      'How often returns are reinvested (daily, monthly, quarterly, annually). Higher frequency yields a slightly higher effective return for the same nominal rate.',
  },
  'PROJECTION DETAIL LEVEL': {
    term: 'Projection detail level',
    shortDefinition:
      'How the projection chart slices your investments: a single line, three lines by tax bucket, or one line per account.',
  },

  // ─── Roadmap section titles ───────────────────────────────────────────
  IRA: {
    term: 'IRA',
    shortDefinition:
      'Individual Retirement Account — a tax-advantaged account you fund yourself (separate from a workplace 401(k)).',
  },
  'AFTER-TAX & TAXABLE': {
    term: 'After-Tax & Taxable',
    shortDefinition:
      'The "taxable brokerage" tier — money already taxed as wages; sales realize capital gains.',
  },

  // ─── Sidebar nav terms (proper-noun, do not rename) ───────────────────
  TICKERS: {
    term: 'Tickers',
    shortDefinition:
      'The short symbols used to identify stocks, ETFs, and mutual funds on an exchange (e.g., VTI, AAPL, VOO).',
  },
  'GROWTH & TAX': {
    term: 'Growth & Tax',
    shortDefinition:
      'The Inputs page where you tune assumptions about long-term growth rates and tax-rule schedules used by every projection.',
  },
};

/**
 * Case-insensitive lookup. Returns `null` if the term is unknown.
 */
export function getGlossaryEntry(term: string): GlossaryEntry | null {
  const upper = term.trim().toUpperCase();
  return GLOSSARY[upper] ?? null;
}

/**
 * Convenience — all known terms, useful for tests, devtools, and exhaustive
 * coverage scans.
 */
export function allGlossaryKeys(): string[] {
  return Object.keys(GLOSSARY);
}
