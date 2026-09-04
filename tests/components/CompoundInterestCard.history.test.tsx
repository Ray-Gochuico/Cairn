/**
 * W2 — CompoundInterestCard History view.
 *
 * Sibling file by design (D-P7): its own recharts mock, so the landed post-W5
 * CompoundInterestCard.test.tsx baseline stays byte-identical.
 *
 * Seeding is the landed demo scenario (pv 1,000 · 1,200/yr · 7% APY) with the
 * years knob at its 10-year default — so M(10) = 143 and the CH-3 literal below
 * is byte-exact.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ComposedChart: ({ children, data }: { children?: React.ReactNode; data?: unknown[] }) => (
    <div data-testid="rc-composed-chart" data-rows={JSON.stringify(data ?? [])}>
      {children}
    </div>
  ),
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Line: (p: Record<string, unknown>) => (
    <div
      data-testid={`rc-line-${String(p.dataKey)}`}
      data-stroke={String(p.stroke ?? '')}
      data-stroke-width={String(p.strokeWidth ?? '')}
      data-animation={String(p.isAnimationActive)}
    />
  ),
  Area: (p: Record<string, unknown>) => (
    <div
      data-testid={`rc-area-${String(p.dataKey)}`}
      data-stack={String(p.stackId ?? '')}
      data-fill={String(p.fill ?? '')}
      data-fill-opacity={String(p.fillOpacity ?? '')}
      data-animation={String(p.isAnimationActive)}
      data-tooltip-type={String(p.tooltipType ?? '')}
      data-legend-type={String(p.legendType ?? '')}
    />
  ),
  ReferenceDot: (p: Record<string, unknown>) => (
    <div data-testid="rc-refdot" data-x={String(p.x)} data-shape={p.shape ? 'custom' : ''} />
  ),
}));

import { CompoundInterestCard } from '@/pages/calculators/CompoundInterestCard';
import { useAcceptancesStore } from '@/stores/disclosure-acceptances-store';
import { useHouseholdStore } from '@/stores/household-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { DISCLOSURES } from '@/legal/disclosures';
import { SCENARIO_STORAGE_KEY } from '@/lib/calculators/scenario-assumptions';
import { __resetScenarioAssumptionsForTests } from '@/lib/calculators/use-scenario-assumptions';
import {
  CALCULATORS_PAGE_ID,
  __resetDollarBasisForTests,
  useDollarBasisStore,
  type DollarBasis,
} from '@/lib/calculators/dollar-basis';
import { historyFan } from '@/lib/history-fan';
import { fanCaption } from '@/lib/calculators/history-fan-copy';
import type { AppSettings } from '@/types/schema';

/** The landed demo scenario: pv 1,000 · 1,200/yr · 7% APY (years knob = 10). */
const SEEDED_PV = 1_000;
const SEEDED_ANNUAL_CONTRIBUTION = 1_200;

function seedDemoScenario() {
  sessionStorage.setItem(
    SCENARIO_STORAGE_KEY,
    JSON.stringify({ portfolio: SEEDED_PV, annualContribution: SEEDED_ANNUAL_CONTRIBUTION, returnPct: 7 }),
  );
}

const renderCard = () => render(<CompoundInterestCard cardId="compound-interest" />);

const acceptBacktest = () =>
  useAcceptancesStore.setState({
    acceptedVersions: { backtest: DISCLOSURES.backtest.version },
    status: 'ready',
    isLoading: false,
    error: null,
  });

const clickHistory = () => fireEvent.click(screen.getByRole('button', { name: 'History' }));
const setYears = (n: number) =>
  fireEvent.change(screen.getByLabelText(/length \(years\)/i), { target: { value: String(n) } });

beforeEach(() => {
  sessionStorage.clear();
  __resetScenarioAssumptionsForTests();
  __resetDollarBasisForTests();
  useAcceptancesStore.setState({
    acceptedVersions: {},
    status: 'ready',
    isLoading: false,
    error: null,
  });
  useSettingsStore.setState({
    settings: { defaultInflation: 0.025 } as AppSettings,
    isLoading: false,
    error: null,
  });
  useHouseholdStore.setState({ household: null, isLoading: false, error: null });
  useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null });
  useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
  seedDemoScenario();
});
afterEach(() => vi.restoreAllMocks());

describe('CompoundInterestCard — History view', () => {
  beforeEach(() => acceptBacktest());

  it('CH-8 label + fan + median render; the variance lines are Assumed-only', () => {
    renderCard();
    clickHistory();
    expect(screen.getByTestId('compound-history-chart-caption')).toHaveTextContent(
      "Balance over time — history (today's $)",
    );
    expect(screen.getByTestId('rc-area-fanFloor')).toBeInTheDocument();
    expect(screen.getByTestId('rc-area-fan2575')).toBeInTheDocument();
    expect(screen.getByTestId('rc-line-p50')).toBeInTheDocument();
    expect(screen.queryByTestId('rc-line-low')).toBeNull();
    expect(screen.queryByTestId('rc-line-high')).toBeNull();
    expect(screen.queryByTestId('rc-line-mid')).toBeNull();
    // No hero cairn on an order statistic.
    for (const dot of screen.queryAllByTestId('rc-refdot')) {
      expect(dot.getAttribute('data-shape')).not.toBe('custom');
    }
    // W2 review fix (MAJOR 0/1): the hand-rolled legend is the only legend, and
    // Compound's single line series IS the median — it is never doubled.
    const legend = screen.getByTestId('history-fan-legend');
    expect(
      Array.from(legend.querySelectorAll(':scope > span')).map((s) => s.textContent?.trim()),
    ).toEqual(['25th–75th percentile', 'Median (p50)']);
  });

  it('AXIS PIN (m2): History rows begin at "Year 0" anchored at round(pv); Assumed rows begin at "Year 1"', () => {
    renderCard();
    clickHistory();
    const rows = JSON.parse(
      screen.getByTestId('rc-composed-chart').getAttribute('data-rows') ?? '[]',
    ) as Array<{ year: string; fanFloor: number; fan2575: number; p50: number }>;
    expect(rows[0].year).toBe('Year 0');
    expect(rows[0].fanFloor).toBe(SEEDED_PV);
    expect(rows).toHaveLength(11);
    expect(rows[rows.length - 1].year).toBe('Year 10');
    // The plotted rows ARE the engine census, encoded as the delta stack.
    const expected = historyFan({
      pv: SEEDED_PV,
      annualContribution: SEEDED_ANNUAL_CONTRIBUTION,
      horizonYears: 10,
    });
    expect(rows[10].fanFloor).toBe(expected.byYear.p25[10]);
    expect(rows[10].fan2575).toBe(expected.byYear.p75[10] - expected.byYear.p25[10]);
    expect(rows[10].p50).toBe(expected.byYear.p50[10]);
    // …and the Assumed view keeps its shipped Year-1 domain.
    fireEvent.click(screen.getByRole('button', { name: 'Assumed' }));
    const assumed = JSON.parse(
      screen.getByTestId('rc-composed-chart').getAttribute('data-rows') ?? '[]',
    ) as Array<{ year: string }>;
    expect(assumed[0].year).toBe('Year 1');
  });

  it('CH-3 + CH-4 captions byte-exact; NO holds line ever (D-UB9)', () => {
    renderCard();
    clickHistory();
    expect(screen.getByTestId('compound-history-caption')).toHaveTextContent(
      fanCaption({ M: 143, H: 10 }),
    );
    expect(screen.getByTestId('compound-history-caption')).toHaveTextContent(
      "At each year, the shaded band spans the middle half (25th–75th) of the balances the 143 full 10-year stretches in the bundled U.S. dataset (1871–2022) had reached by that year; the line is the per-year median, not any single stretch's path. 75% stocks / 25% bonds, rebalanced yearly, gross of fees · today's dollars, in both page views · history, not a forecast.",
    );
    expect(screen.getByTestId('compound-history-cadence')).toHaveTextContent(
      'History compounds annually at real (CPI-adjusted) historical returns — the return rate, frequency and variance knobs apply to the assumed view.',
    );
    // CH-3 drift-guard: the caption paraphrases DISCLOSURES.backtest — a future
    // body edit bumps the version, trips this pin, and forces a conscious review.
    expect(DISCLOSURES.backtest.version).toBe('1.4');
    // A holds rate without a criterion would be invented meaning.
    expect(screen.queryByTestId('compound-holds')).toBeNull();
    expect(screen.queryByText(/not a probability/)).toBeNull();
  });

  it('headline + StatTiles keep the parametric engine and the page basis (D-UB4)', () => {
    renderCard();
    const headlineAssumed = screen.getByTestId('compound-headline').textContent;
    const contributedAssumed = screen.getByTestId('compound-total-contributed').textContent;
    clickHistory();
    expect(screen.getByTestId('compound-headline').textContent).toBe(headlineAssumed);
    expect(screen.getByTestId('compound-total-contributed').textContent).toBe(contributedAssumed);
    expect(screen.getByTestId('compound-headline').textContent).toContain("in today's dollars");
  });

  it('the variance and frequency knobs stay live in History (no dead controls)', () => {
    renderCard();
    clickHistory();
    expect(screen.getByLabelText(/variance/i)).toBeEnabled();
    expect(screen.getByRole('combobox', { name: /compound frequency/i })).toBeEnabled();
    expect(screen.getByLabelText(/length \(years\)/i)).toBeEnabled();
  });

  it('degradation CH-5: years=140 ⇒ the too-few line (M=13), no fan', () => {
    renderCard();
    setYears(140);
    clickHistory();
    expect(screen.getByTestId('compound-history-degraded')).toHaveTextContent(
      'Only 13 full 140-year stretches exist in the 1871–2022 data — too few to draw a meaningful middle half.',
    );
    expect(screen.queryByTestId('rc-area-fan2575')).toBeNull();
    expect(screen.queryByTestId('compound-history-caption')).toBeNull();
  });

  it('degradation CH-6: years=155 ⇒ the no-stretch line', () => {
    renderCard();
    setYears(155);
    clickHistory();
    expect(screen.getByTestId('compound-history-degraded')).toHaveTextContent(
      'No full 155-year stretch exists in the 1871–2022 data.',
    );
    expect(screen.queryByTestId('rc-area-fan2575')).toBeNull();
  });
});

describe('CompoundInterestCard — control + gate parity', () => {
  it('defaults to Assumed; the control persists under this card’s own key', () => {
    acceptBacktest();
    renderCard();
    expect(screen.getByRole('group', { name: 'Return source' })).toBeInTheDocument();
    expect(screen.getByTestId('compound-chart')).toBeInTheDocument();
    clickHistory();
    expect(sessionStorage.getItem('calc-chart-source:compound-interest')).toBe('HISTORY');
    expect(sessionStorage.getItem('calc-chart-source:path-to-fi')).toBeNull();
  });

  it('un-accepted History click opens the modal; cancel stays Assumed', () => {
    renderCard();
    clickHistory();
    expect(screen.getByTestId('disclosure-modal-body')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('rc-area-fan2575')).toBeNull();
    expect(screen.getByTestId('compound-chart')).toBeInTheDocument();
  });

  it('accept switches to History and records the shared backtest consent', async () => {
    const accept = vi.fn(async (id: string, version: string) => {
      useAcceptancesStore.setState((s) => ({
        acceptedVersions: { ...s.acceptedVersions, [id]: version },
      }));
    });
    useHouseholdStore.setState({ acceptDisclaimer: accept } as never);
    renderCard();
    clickHistory();
    fireEvent.click(
      screen.getByRole('checkbox', { name: DISCLOSURES.backtest.acceptanceCheckboxLabel }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByTestId('rc-area-fan2575')).toBeInTheDocument();
    expect(accept).toHaveBeenCalledWith('backtest', DISCLOSURES.backtest.version);
  });

  it('restart-safe: stored HISTORY + un-accepted renders Assumed', () => {
    sessionStorage.setItem('calc-chart-source:compound-interest', 'HISTORY');
    renderCard();
    expect(screen.getByTestId('compound-chart')).toBeInTheDocument();
    expect(screen.queryByTestId('rc-area-fan2575')).toBeNull();
  });
});

describe('CompoundInterestCard — pinned basis (D-UB13)', () => {
  const flipBasis = (b: DollarBasis) =>
    act(() => useDollarBasisStore.getState().setBasis(CALCULATORS_PAGE_ID, b));

  it('fan rows + captions byte-identical across page bases; the tiles flip', () => {
    acceptBacktest();
    renderCard();
    clickHistory();
    const rows = () => screen.getByTestId('rc-composed-chart').getAttribute('data-rows');
    const caption = () => screen.getByTestId('compound-history-caption').textContent;
    const label = () => screen.getByTestId('compound-history-chart-caption').textContent;

    const rowsToday = rows();
    const captionToday = caption();
    const headlineToday = screen.getByTestId('compound-headline').textContent;

    flipBasis('future');
    expect(rows()).toBe(rowsToday); // PINNED: history is never re-inflated
    expect(caption()).toBe(captionToday);
    expect(label()).toBe("Balance over time — history (today's $)");
    expect(screen.getByTestId('compound-headline').textContent).not.toBe(headlineToday);
    expect(screen.getByTestId('compound-headline').textContent).toContain('in future dollars');

    flipBasis('today');
    expect(rows()).toBe(rowsToday);
  });

  it('the History view renders no unphrased dollar figure of its own', () => {
    acceptBacktest();
    renderCard();
    clickHistory();
    for (const testId of [
      'compound-history-caption',
      'compound-history-cadence',
      'history-fan-legend',
    ]) {
      expect(screen.getByTestId(testId).textContent ?? '').not.toMatch(/\$\s?\d/);
    }
    expect(screen.getByTestId('compound-history-chart-caption').textContent).toContain(
      "(today's $)",
    );
  });
});
