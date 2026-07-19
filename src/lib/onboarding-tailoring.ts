import type {
  Person,
  Account,
  Holding,
  Property,
  Vehicle,
  EquityGrant,
  Loan,
} from '@/types/schema';
import { calculatorCardLabel } from '@/lib/calculator-card-layout';

/** A non-core sidebar tab the tailoring engine may recommend hiding. */
export interface TailorTab {
  to: string;
  label: string;
  visible: boolean;
  reason: string;
}

/** A calculator card the tailoring engine may recommend hiding. */
export interface TailorCalc {
  id: string;
  label: string;
  visible: boolean;
  reason: string;
}

/** The full show/hide recommendation set produced by {@link computeTailoring}. */
export interface TailoringResult {
  tabs: TailorTab[];
  calculators: TailorCalc[];
}

/**
 * Everything the engine reads. `today` is injected (never the process clock)
 * so the result is deterministic; it is reserved for any future age rule and
 * is passed straight to `currentAgeAsOf` if one is added — there is no age
 * rule today (the 401k calculator is always shown), so the engine does not
 * currently read it.
 */
export interface TailoringInput {
  persons: Person[];
  accounts: Account[];
  holdings: Holding[];
  properties: Property[];
  vehicles: Vehicle[];
  equityGrants: EquityGrant[];
  loans: Loan[];
  today: Date;
}

// Conditional-calculator predicates over the person list (any-person OR).
const anyBonus = (persons: Person[]) => persons.some((p) => p.expectedBonus > 0);
const anyCommission = (persons: Person[]) => persons.some((p) => p.expectedCommission > 0);
// Must agree with CalculatorsLayout.showOvertime.
const anyOvertime = (persons: Person[]) =>
  persons.some(
    (p) => p.employmentType === 'HOURLY' || p.employmentType === 'SALARY_WITH_OT',
  );

/**
 * Pure tailoring engine. Given the household's entities, returns per-tab and
 * per-calculator show/hide recommendations with a plain-language reason for
 * each row. Reads neither stores nor the clock.
 *
 * Tabs: the four data-bearing non-core tabs are hidden when their entity list
 * is empty (core tabs are always visible and not listed). Calculators: eight
 * are always shown; four are conditional on any person (bonus, commission,
 * overtime) or on grants existing (equity). No age rule.
 */
export function computeTailoring(input: TailoringInput): TailoringResult {
  const { persons, properties, vehicles, equityGrants, loans } = input;

  // Fail-open: with no persons entered, there is nothing to tailor against —
  // every tab and calculator shows. Hiding only begins once the user has at
  // least one person in the household (so the engine can check bonuses, OT
  // status, etc. and so the tab rules make UX sense).
  const hasPerson = persons.length > 0;

  const tabs: TailorTab[] = [
    {
      to: '/property',
      label: 'Property',
      visible: !hasPerson || properties.length > 0,
      reason: properties.length > 0 ? 'You have property entered' : 'No property entered',
    },
    {
      to: '/vehicles',
      label: 'Vehicles',
      visible: !hasPerson || vehicles.length > 0,
      reason: vehicles.length > 0 ? 'You have a vehicle entered' : 'No vehicles entered',
    },
    {
      to: '/equity-grants',
      label: 'Equity Grants',
      visible: !hasPerson || equityGrants.length > 0,
      reason: equityGrants.length > 0 ? 'You have an equity grant entered' : 'No equity grants entered',
    },
    {
      to: '/loans',
      label: 'Loans',
      visible: !hasPerson || loans.length > 0,
      reason: loans.length > 0 ? 'You have a loan entered' : 'No loans entered',
    },
  ];

  const hasBonus = !hasPerson || anyBonus(persons);
  const hasCommission = !hasPerson || anyCommission(persons);
  const hasOvertime = !hasPerson || anyOvertime(persons);
  const hasGrants = !hasPerson || equityGrants.length > 0;

  // Wave 18 B6: the merged Supplemental pay card is useful when EITHER
  // supplemental-pay type exists (the D2 union — mirrors the AND-hidden fold).
  const hasSupplemental = hasBonus || hasCommission;

  const calculators: TailorCalc[] = [
    // Always shown (7).
    { id: 'paycheck', label: calculatorCardLabel('paycheck'), visible: true, reason: 'Always available' },
    { id: 'path-to-fi', label: calculatorCardLabel('path-to-fi'), visible: true, reason: 'Always available' },
    { id: 'compound-interest', label: calculatorCardLabel('compound-interest'), visible: true, reason: 'Always available' },
    { id: 'contribution-allocator', label: calculatorCardLabel('contribution-allocator'), visible: true, reason: 'Always available' },
    { id: 'backtest', label: calculatorCardLabel('backtest'), visible: true, reason: 'Always available' },
    { id: 'retirement-401k-withdrawal', label: calculatorCardLabel('retirement-401k-withdrawal'), visible: true, reason: 'Always available' },
    { id: 'debt-payoff', label: calculatorCardLabel('debt-payoff'), visible: true, reason: 'Always available — add a loan to use it' },
    // Conditional (3).
    {
      id: 'supplemental-pay',
      label: calculatorCardLabel('supplemental-pay'),
      visible: hasSupplemental,
      reason: hasSupplemental
        ? 'You entered an expected bonus or commission'
        : 'No expected bonus or commission entered',
    },
    {
      id: 'overtime',
      label: calculatorCardLabel('overtime'),
      visible: hasOvertime,
      reason: hasOvertime ? 'An hourly / overtime-eligible job is set' : 'No hourly or overtime-eligible job',
    },
    {
      id: 'equity',
      label: calculatorCardLabel('equity'),
      visible: hasGrants,
      reason: hasGrants ? 'You have an equity grant entered' : 'No equity grants entered',
    },
  ];

  return { tabs, calculators };
}

/**
 * True when any tab or calculator is recommended hidden — the controller's
 * skip seam for the Tailor step (skip when there is nothing to prune).
 */
export function hasAnyHideRecommendation(result: TailoringResult): boolean {
  return (
    result.tabs.some((t) => !t.visible) ||
    result.calculators.some((c) => !c.visible)
  );
}
