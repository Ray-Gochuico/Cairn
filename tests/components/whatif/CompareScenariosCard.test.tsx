import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { CompareScenariosCard } from '@/components/whatif/CompareScenariosCard';
import { emptyLeverPayload, type Milestones, type MonthlyState } from '@/lib/scenarios';
import {
  buildPlanReview, lineText, resolveComparePair,
  COMPARE_FOOTER, SECOND_SCENARIO_PROMPT, SEND_POINTER,
} from '@/lib/whatif/plan-review';
import { buildLeverDiff, computeAssumptionParity } from '@/lib/whatif/lever-diff';
import { makeHousehold } from '../../factories';
import { ADVICE_LEXICON, RESERVED_PHRASES } from '../../helpers/advice-lexicon';
import type { Scenario } from '@/types/scenario';

// SaveCurrentDialog reads the scenarios store at runtime — mirror the
// ScenariosPanel.test.tsx mock so the prompt's CTA can open the dialog.
vi.mock('@/stores/scenarios-store', () => ({
  useScenariosStore: () => ({
    saveCurrentAsScenario: vi.fn().mockResolvedValue(99),
  }),
}));

const sc = (id: number, over: Partial<Scenario> = {}): Scenario => ({
  id, name: `S${id}`, isBaseline: false, color: '#4f86f7', lineStyle: 'solid',
  visible: true, isActive: false, sortOrder: id, leverPayload: emptyLeverPayload(),
  createdAt: '2026-08-25T00:00:00Z', updatedAt: '2026-08-25T00:00:00Z', ...over,
});
const baseline = sc(1, { name: 'Baseline', isBaseline: true, isActive: true, sortOrder: 0 });
const other = sc(2, { name: 'Aggressive payoff', color: '#f59e0b' });
const st = (monthISO: string): MonthlyState => ({
  monthISO, investmentsByAccount: {}, homeEquity: 0, cash: 1, debtByLoan: {},
  netWorth: 1, incomeAfterTax: 0, expenses: 0, savings: 0, events: [],
});

const HH = makeHousehold({ withdrawalRate: 0.04, inflationAssumption: 0.03 });

const baseProps = {
  scenarios: [baseline, other],
  projections: new Map([[1, [st('2026-09')]], [2, [st('2026-09')]]]),
  milestones: new Map<number, Milestones>([[1, {} as Milestones], [2, {} as Milestones]]),
  household: HH,
  engineDefaults: { inflation: 0.03 },
  dollarMode: 'nominal' as const,
  horizonMonths: 360,
  displayInflation: 0.03,
  deflatorSourceLabel: 'your household setting',
  loanNames: {},
  pair: resolveComparePair([baseline, other], { aId: null, bId: null }, null),
  onSelectA: vi.fn(),
  onSelectB: vi.fn(),
};
const renderCard = (over: Partial<typeof baseProps> = {}) =>
  render(<MemoryRouter><CompareScenariosCard {...baseProps} {...over} /></MemoryRouter>);

/**
 * Every narrative line the card paints, in DOM order. Lines carry emphasis
 * spans, so RTL's getByText (which joins DIRECT text-node children only)
 * cannot see a whole line — reading the <p> elements' textContent pins the
 * full ordered list instead, which is a strictly stronger verbatim check.
 */
const cardLines = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll('p')).map((p) => p.textContent ?? '');

describe('CompareScenariosCard', () => {
  it('renders the model VERBATIM — no copy composed in TSX', () => {
    const { container } = renderCard();
    const expected = buildPlanReview({
      a: { name: 'Baseline', payload: baseline.leverPayload, states: [st('2026-09')], milestones: {} as Milestones },
      b: { name: 'Aggressive payoff', payload: other.leverPayload, states: [st('2026-09')], milestones: {} as Milestones },
      dollarMode: 'nominal', horizonMonths: 360,
      deflator: { rate: 0.03, sourceLabel: 'your household setting' },
      parity: computeAssumptionParity(baseline.leverPayload, other.leverPayload, HH, { inflation: 0.03 }),
      leverDiff: buildLeverDiff(baseline.leverPayload, other.leverPayload, { loanNames: {} }),
    });
    expect(cardLines(container)).toEqual(
      [...expected.yardstick, expected.bottomLine, ...expected.tradeoffs, ...expected.mainDifference].map(lineText),
    );
    expect(screen.getByText(lineText(expected.bottomLine))).toBeInTheDocument();
    expect(screen.getByText(COMPARE_FOOTER)).toBeInTheDocument();
  });

  it('real mode renders the deflator clause the model built', () => {
    const { container } = renderCard({
      dollarMode: 'real',
      scenarios: [baseline, sc(2, { name: 'Aggressive payoff', leverPayload: { ...emptyLeverPayload(), inflation: { defaultRate: 0.04, overrides: {} } } })],
      pair: { a: baseline, b: sc(2, { name: 'Aggressive payoff', leverPayload: { ...emptyLeverPayload(), inflation: { defaultRate: 0.04, overrides: {} } } }) },
    });
    expect(cardLines(container)).toContain(
      "One deflator: today's-dollar conversion uses one inflation rate — 3%, your household setting — applied to every line."
      + ' Aggressive payoff is projected at 4% inflation but deflated at 3% here.',
    );
  });

  it('headings + picker chrome are the pinned literals', () => {
    renderCard();
    expect(screen.getByText('Compare scenarios')).toBeInTheDocument();
    expect(screen.getByText('Same yardstick')).toBeInTheDocument();
    expect(screen.getByText('Bottom line')).toBeInTheDocument();
    expect(screen.getByText('Main difference')).toBeInTheDocument();
    expect(screen.getByLabelText('Compare scenario A')).toBeInTheDocument();
    expect(screen.getByLabelText('Compare scenario B')).toBeInTheDocument();
    expect(screen.getByText('vs')).toBeInTheDocument();
  });

  it("B's option list excludes A; picking drives the callbacks (native select, jsdom-driveable)", async () => {
    const user = userEvent.setup();
    const third = sc(3, { name: 'Third' });
    renderCard({
      scenarios: [baseline, other, third],
      pair: resolveComparePair([baseline, other, third], { aId: null, bId: null }, null),
    });
    const selB = screen.getByLabelText('Compare scenario B') as HTMLSelectElement;
    expect([...selB.options].map((o) => o.textContent)).toEqual(['Aggressive payoff', 'Third']); // no Baseline (= A)
    const selA = screen.getByLabelText('Compare scenario A') as HTMLSelectElement;
    expect([...selA.options].map((o) => o.textContent)).toEqual(['Baseline', 'Aggressive payoff', 'Third']);
    await user.selectOptions(selB, '3');
    expect(baseProps.onSelectB).toHaveBeenCalledWith(3);
    await user.selectOptions(selA, '2');
    expect(baseProps.onSelectA).toHaveBeenCalledWith(2);
  });

  it('the picker is a lens: neither callback writes visible or isActive', () => {
    renderCard();
    expect(baseline.visible).toBe(true);
    expect(baseline.isActive).toBe(true);
    expect(other.visible).toBe(true);
    expect(other.isActive).toBe(false);
  });

  it('single scenario → the quiet prompt with the shipped CTA and the muted pointer', async () => {
    const user = userEvent.setup();
    renderCard({ scenarios: [baseline], pair: { a: baseline, b: null } });
    expect(screen.getByText(SECOND_SCENARIO_PROMPT)).toBeInTheDocument();
    expect(screen.getByText(SEND_POINTER)).toBeInTheDocument();
    expect(screen.queryByText('Bottom line')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '+ Save current' }));
    expect(screen.getByText('Save current as scenario')).toBeInTheDocument(); // SaveCurrentDialog title
    // D-W3-P4 (review MINOR 10): defaultName mirrors ScenariosPanel.tsx:253 —
    // `Scenario ${non-baseline count + 1}`, so a baseline-only page offers
    // "Scenario 1" rather than skipping a number.
    expect((screen.getByLabelText('Scenario name') as HTMLInputElement).value).toBe('Scenario 1');
  });

  it('the dialog default name counts USER scenarios, not the baseline', async () => {
    const user = userEvent.setup();
    // Two user scenarios present but only one rendered pair side → the prompt
    // branch is driven by scenarios.length, so use a single-entry list whose
    // one member is a non-baseline scenario.
    renderCard({ scenarios: [other], pair: { a: other, b: null } });
    await user.click(screen.getByRole('button', { name: '+ Save current' }));
    expect((screen.getByLabelText('Scenario name') as HTMLInputElement).value).toBe('Scenario 2');
  });

  it('zero scenarios → nothing at all (the page empty states own the moment)', () => {
    const { container } = renderCard({ scenarios: [], pair: { a: null, b: null } });
    expect(container.querySelector('[data-testid="whatif-compare-card"]')).toBeNull();
  });

  it('refusal path: a side with no projection rows never fabricates figures', () => {
    renderCard({ projections: new Map([[1, [st('2026-09')]], [2, []]]) });
    expect(screen.getByText('Projection unavailable for Aggressive payoff.')).toBeInTheDocument();
    expect(screen.queryByText('Tradeoffs')).not.toBeInTheDocument();
    expect(screen.queryByText('Main difference')).not.toBeInTheDocument();
  });

  it('honesty clauses are never clamped (wide-bar lesson, smoke fix 656d1bae)', () => {
    const { container } = renderCard();
    expect(container.innerHTML).not.toMatch(/line-clamp|truncate/);
  });

  it('a11y: one labelled section, color dots hidden from AT', () => {
    const { container } = renderCard();
    const section = container.querySelector('section[aria-labelledby="compare-scenarios-heading"]');
    expect(section).not.toBeNull();
    expect(container.querySelector('#compare-scenarios-heading')?.textContent).toBe('Compare scenarios');
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThanOrEqual(1);
  });

  it('carries neither reserved phrase nor an exclamation mark', () => {
    const { container } = renderCard();
    for (const phrase of RESERVED_PHRASES) expect(container.textContent).not.toContain(phrase);
    expect(container.textContent).not.toContain('!');
  });

  // Review MINOR 0: the same shared lexicon the lib tests use, applied to the
  // RENDERED narrative lines. The fixed footer is a <div>, not a <p>, so the
  // one contract-exempt string ("…not advice, not a recommendation.") stays
  // out of the scan without a bespoke carve-out.
  it('no prescriptive lexeme in any rendered narrative line', () => {
    const rich = renderCard({
      dollarMode: 'real',
      milestones: new Map<number, Milestones>([
        [1, { financialIndependenceISO: '2040-06', debtFreeISO: '2028-03', netWorth30y: 900_000 } as Milestones],
        [2, { financialIndependenceISO: '2043-06', debtFreeISO: '2030-03', netWorth30y: 400_000 } as Milestones],
      ]),
    });
    const lines = cardLines(rich.container);
    expect(lines.length).toBeGreaterThanOrEqual(5);
    for (const line of lines) {
      expect(line).not.toMatch(ADVICE_LEXICON);
      for (const phrase of RESERVED_PHRASES) expect(line).not.toContain(phrase);
    }
  });
});
