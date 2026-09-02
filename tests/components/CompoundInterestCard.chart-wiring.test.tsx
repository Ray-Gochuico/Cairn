import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CompoundInterestCard } from '@/pages/calculators/CompoundInterestCard';
import { formatCurrency } from '@/lib/format';
import { SCENARIO_STORAGE_KEY } from '@/lib/calculators/scenario-assumptions';
import { __resetScenarioAssumptionsForTests } from '@/lib/calculators/use-scenario-assumptions';
import {
  CALCULATORS_PAGE_ID,
  __resetDollarBasisForTests,
  useDollarBasisStore,
} from '@/lib/calculators/dollar-basis';
import { useSettingsStore } from '@/stores/settings-store';
import { useHouseholdStore } from '@/stores/household-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useAccountsStore } from '@/stores/accounts-store';
import type { AppSettings } from '@/types/schema';

// Probe: replace InlineChart with a JSON dump of its `data` prop — the render
// sweep cannot see plotted values (spec m4); this pins the wiring instead.
vi.mock('@/components/charts/InlineChart', () => ({
  InlineChart: (props: {
    data: Array<Record<string, unknown>>;
    label?: string;
    labelTestId?: string;
    testId?: string;
  }) => (
    <div data-testid={props.testId ?? 'chart'}>
      <div data-testid={props.labelTestId}>{props.label}</div>
      <pre data-testid={`${props.testId ?? 'chart'}-data-probe`}>{JSON.stringify(props.data)}</pre>
    </div>
  ),
}));

describe('W5 chart wiring (m4 layer b): plotted terminal mid IS the headline figure', () => {
  beforeEach(() => {
    sessionStorage.clear();
    __resetScenarioAssumptionsForTests();
    __resetDollarBasisForTests();
    useSettingsStore.setState({
      settings: { defaultInflation: 0.025 } as AppSettings,
      isLoading: false,
      error: null,
    });
    useHouseholdStore.setState({ household: null, isLoading: false, error: null });
    useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null });
    useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
    sessionStorage.setItem(
      SCENARIO_STORAGE_KEY,
      JSON.stringify({ portfolio: 1000, annualContribution: 1200, returnPct: 7 }),
    );
  });

  it('tooltip-agreement law holds in BOTH bases', () => {
    render(<CompoundInterestCard />);
    const terminalMid = () => {
      const data = JSON.parse(
        screen.getByTestId('compound-chart-data-probe').textContent ?? '[]',
      ) as Array<{ mid: number }>;
      return data[data.length - 1].mid;
    };
    const headlineFigure = () =>
      screen.getByTestId('compound-headline').textContent?.match(/\$[\d,]+/)?.[0];

    expect(formatCurrency(terminalMid())).toBe(headlineFigure()); // today
    act(() => useDollarBasisStore.getState().setBasis(CALCULATORS_PAGE_ID, 'future'));
    expect(formatCurrency(terminalMid())).toBe(headlineFigure()); // future
  });
});
