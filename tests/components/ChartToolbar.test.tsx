import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ChartToolbar from '@/components/whatif/ChartToolbar';
import { useScenariosStore } from '@/stores/scenarios-store';
import { ProjectionDetailLevel } from '@/types/enums';

function resetStore() {
  useScenariosStore.setState({
    scenarios: [],
    isLoading: false,
    error: null,
    horizonMonths: 360,
    dollarMode: 'nominal',
    inflation: 0.025,
    defaultReturnRate: 0.07,
  });
}

const noopChange = () => {};

describe('ChartToolbar', () => {
  beforeEach(() => { resetStore(); });

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

  it('renders nominal/real toggle with nominal pressed by default', () => {
    render(
      <MemoryRouter>
        <ChartToolbar detailLevel={ProjectionDetailLevel.TAX_BUCKET} onDetailLevelChange={noopChange} />
      </MemoryRouter>,
    );
    // The toggle Buttons have exact text "Nominal" / "Real"; the
    // sibling TermTooltip info-buttons added in UX W3-2 use the
    // accessible name "Definition for ..." which the ^...$ anchors
    // exclude so each test selects exactly one button.
    expect(screen.getByRole('button', { name: /^nominal$/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /^real$/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('clicking Real flips dollarMode and aria-pressed state', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ChartToolbar detailLevel={ProjectionDetailLevel.TAX_BUCKET} onDetailLevelChange={noopChange} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: /^real$/i }));
    expect(useScenariosStore.getState().dollarMode).toBe('real');
    expect(screen.getByRole('button', { name: /^real$/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /^nominal$/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
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
  beforeEach(() => { resetStore(); });

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

  // UX W3-2: each toggle button must have its own glossary popover
  // trigger via a sibling TermTooltip (we can't nest a TermTooltip
  // button inside the toggle Button without breaking aria-pressed).
  // The TermTooltip trigger renders an sr-only "Definition for X"
  // label so screen readers reach each term.
  it('UX W3-2: every dollar-mode + detail-level toggle has a sibling TermTooltip', () => {
    render(
      <MemoryRouter>
        <ChartToolbar detailLevel={ProjectionDetailLevel.TAX_BUCKET} onDetailLevelChange={noopChange} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: /definition for nominal/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /definition for real/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /definition for single/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /definition for tax bucket/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /definition for per account/i })).toBeInTheDocument();
  });
});
