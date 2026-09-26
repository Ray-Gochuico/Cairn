import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ChartToolbar from '@/components/whatif/ChartToolbar';
import { useScenariosStore } from '@/stores/scenarios-store';
import { ProjectionDetailLevel } from '@/types/enums';
import {
  WHATIF_PAGE_ID,
  __resetDollarBasisForTests,
  useDollarBasisStore,
} from '@/lib/calculators/dollar-basis';

function resetStore() {
  useScenariosStore.setState({
    scenarios: [],
    isLoading: false,
    error: null,
    horizonMonths: 360,
    inflation: 0.025,
    defaultReturnRate: 0.07,
  });
}

const noopChange = () => {};

describe('ChartToolbar', () => {
  beforeEach(() => {
    resetStore();
    sessionStorage.clear();
    __resetDollarBasisForTests();
  });

  it('renders the horizon slider showing the current value in years', () => {
    render(
      <MemoryRouter>
        <ChartToolbar detailLevel={ProjectionDetailLevel.TAX_BUCKET} onDetailLevelChange={noopChange} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/30 years/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/horizon/i)).toHaveValue('360');
  });

  it('moving the horizon slider updates the store (clamped to [60, 480])', () => {
    render(
      <MemoryRouter>
        <ChartToolbar detailLevel={ProjectionDetailLevel.TAX_BUCKET} onDetailLevelChange={noopChange} />
      </MemoryRouter>,
    );
    const slider = screen.getByLabelText(/horizon/i) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '240' } });
    expect(useScenariosStore.getState().horizonMonths).toBe(240);
  });

  it("W5.1: renders the SHARED Dollar basis control with Today's $ pressed by default (D-T3) and no scope note", () => {
    render(
      <MemoryRouter>
        <ChartToolbar detailLevel={ProjectionDetailLevel.TAX_BUCKET} onDetailLevelChange={noopChange} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('group', { name: 'Dollar basis' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Today's $" })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Future $' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('dollar-basis-scope-note')).toBeNull();
    expect(screen.queryByRole('button', { name: /^nominal$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^real$/i })).toBeNull();
  });

  it('W5.1: clicking Future $ writes the WHAT-IF basis, never the calculators one', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ChartToolbar detailLevel={ProjectionDetailLevel.TAX_BUCKET} onDetailLevelChange={noopChange} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Future $' }));
    expect(useDollarBasisStore.getState().byPage[WHATIF_PAGE_ID]).toBe('future');
    expect(sessionStorage.getItem('calc-basis:whatif')).toBe('future');
    expect(sessionStorage.getItem('calc-basis:calculators')).toBeNull();
    expect(screen.getByRole('button', { name: 'Future $' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: "Today's $" })).toHaveAttribute('aria-pressed', 'false');
  });

  it('reflects the store state when horizonMonths changes externally', () => {
    useScenariosStore.setState({ horizonMonths: 120 });
    render(
      <MemoryRouter>
        <ChartToolbar detailLevel={ProjectionDetailLevel.TAX_BUCKET} onDetailLevelChange={noopChange} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/10 years/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/horizon/i)).toHaveValue('120');
  });
});

describe('ChartToolbar — projection detail level segmented control', () => {
  beforeEach(() => {
    resetStore();
    sessionStorage.clear();
    __resetDollarBasisForTests();
  });

  it('renders three segments: Single, Tax bucket, Per account', () => {
    render(
      <MemoryRouter>
        <ChartToolbar detailLevel={ProjectionDetailLevel.TAX_BUCKET} onDetailLevelChange={noopChange} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: /^single$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^tax bucket$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^per account$/i })).toBeInTheDocument();
  });

  it('active segment reflects the detailLevel prop', () => {
    render(
      <MemoryRouter>
        <ChartToolbar detailLevel={ProjectionDetailLevel.PER_ACCOUNT} onDetailLevelChange={noopChange} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: /^per account$/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^single$/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /^tax bucket$/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking a segment calls onDetailLevelChange with the new level', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MemoryRouter>
        <ChartToolbar detailLevel={ProjectionDetailLevel.TAX_BUCKET} onDetailLevelChange={onChange} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: /^single$/i }));
    expect(onChange).toHaveBeenCalledWith('single');

    await user.click(screen.getByRole('button', { name: /^per account$/i }));
    expect(onChange).toHaveBeenCalledWith('per_account');
  });

  it('exposes a labelled role=group wrapper for screen readers', () => {
    render(
      <MemoryRouter>
        <ChartToolbar detailLevel={ProjectionDetailLevel.TAX_BUCKET} onDetailLevelChange={noopChange} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('group', { name: /projection detail level/i })).toBeInTheDocument();
  });

  // A-11(8) (v1.7.1): the B2 smoke read the "Detail:" label 5 px below its
  // options. Measured at plan time (Chromium, 1024 and 1440): the TEXT
  // baselines agree within 0.25 px; the 5 px is the label BOX — 21.5 px tall,
  // centred against the 32 px size="sm" options, so it sits 5.25 px inside
  // their top and bottom edges. The label box now takes the options' own
  // height token, so label and options share one row box (smoke S7 measures
  // both deltas; jsdom has no layout).
  it("A-11(8): the Detail label box takes the options' height token and centres its text", () => {
    render(
      <MemoryRouter>
        <ChartToolbar detailLevel={ProjectionDetailLevel.TAX_BUCKET} onDetailLevelChange={noopChange} />
      </MemoryRouter>,
    );
    const group = screen.getByRole('group', { name: 'Projection detail level' });
    const label = group.querySelector('label')!;
    const heights = [...within(group).getByRole('button', { name: /^single$/i }).classList].filter((c) => /^h-\d+$/.test(c));
    expect(heights).toEqual(['h-8']); // guard: the size="sm" option height this label matches
    expect(label).toHaveClass('inline-flex', 'items-center', heights[0]);
  });

  // UX W3-2: each toggle button must have its own glossary popover
  // trigger via a sibling TermTooltip (we can't nest a TermTooltip
  // button inside the toggle Button without breaking aria-pressed).
  // The TermTooltip trigger renders an sr-only "Definition for X"
  // label so screen readers reach each term.
  it('UX W3-2 / W5.1: every basis + detail-level control has its glossary trigger', () => {
    render(
      <MemoryRouter>
        <ChartToolbar detailLevel={ProjectionDetailLevel.TAX_BUCKET} onDetailLevelChange={noopChange} />
      </MemoryRouter>,
    );
    // W5.1 (m7): the shared control carries ONE trigger whose entry
    // (NOMINAL VS REAL) teaches both vocabularies, in place of the two
    // per-button "Definition for nominal/real" triggers that died with the group.
    expect(screen.getByRole('button', { name: /^dollar basis$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /definition for single/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /definition for tax bucket/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /definition for per account/i })).toBeInTheDocument();
  });
});
