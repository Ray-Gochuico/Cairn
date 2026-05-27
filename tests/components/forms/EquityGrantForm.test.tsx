import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import EquityGrantForm, {
  DEFAULT_EQUITY_GRANT,
  type EquityGrantFormValues,
} from '@/components/forms/EquityGrantForm';

const personOptions = [{ id: 1, name: 'Alice' }];

function setupForm(opts: {
  initial?: Partial<EquityGrantFormValues>;
  onSubmit?: (v: EquityGrantFormValues) => Promise<void>;
} = {}) {
  const onSubmit = opts.onSubmit ?? vi.fn(async () => {});
  const onCancel = vi.fn();
  render(
    <MemoryRouter>
      <EquityGrantForm
        initial={{ ...DEFAULT_EQUITY_GRANT, ...opts.initial }}
        persons={personOptions}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    </MemoryRouter>,
  );
  return { onSubmit, onCancel };
}

async function selectDate(user: UserEvent, pickerId: string, isoDate: string) {
  const [yyyy, mm, dd] = isoDate.split('-');
  const root = screen.getByTestId(`${pickerId}-picker`);
  await user.selectOptions(within(root).getByLabelText('Year'), yyyy);
  await user.selectOptions(within(root).getByLabelText('Month'), mm);
  await user.selectOptions(within(root).getByLabelText('Day'), dd);
}

describe('EquityGrantForm — calculator section', () => {
  it('renders a collapsible calculator section', () => {
    setupForm();
    expect(
      screen.getByText(/estimate it from company valuation/i),
    ).toBeInTheDocument();
  });

  it('keeps the calculator collapsed by default in create mode', () => {
    setupForm();
    const summary = screen.getByText(/estimate it from company valuation/i);
    const details = summary.closest('details');
    expect(details?.open).toBe(false);
  });

  it('opens the calculator section by default when initial values are populated (edit mode)', () => {
    setupForm({
      initial: {
        companyValuation: 10_000_000,
        companyOutstandingShares: 5_000_000,
        companyTotalDebt: 0,
      },
    });
    const summary = screen.getByText(/estimate it from company valuation/i);
    const details = summary.closest('details');
    expect(details?.open).toBe(true);
  });

  it('opens the calculator section in edit mode even when only ONE value is non-null', () => {
    setupForm({
      initial: {
        companyValuation: 1_000_000,
      },
    });
    const summary = screen.getByText(/estimate it from company valuation/i);
    const details = summary.closest('details');
    expect(details?.open).toBe(true);
  });

  it('computes per-share value live as user types all three inputs', async () => {
    const user = userEvent.setup();
    setupForm();
    await user.click(screen.getByText(/estimate it from company valuation/i));
    await user.type(screen.getByLabelText(/company valuation/i), '10000000');
    await user.type(screen.getByLabelText(/total debt/i), '2000000');
    await user.type(screen.getByLabelText(/outstanding shares/i), '5000000');
    // The value lives in a sibling <span>; find by exact value text.
    expect(await screen.findByText('$1.60')).toBeInTheDocument();
  });

  it('disables "Use this value" until all three inputs are valid', async () => {
    const user = userEvent.setup();
    setupForm();
    await user.click(screen.getByText(/estimate it from company valuation/i));
    const useBtn = screen.getByRole('button', { name: /use this value/i });
    expect(useBtn).toBeDisabled();
    await user.type(screen.getByLabelText(/company valuation/i), '1000000');
    expect(useBtn).toBeDisabled();
    await user.type(screen.getByLabelText(/total debt/i), '0');
    expect(useBtn).toBeDisabled();
    await user.type(screen.getByLabelText(/outstanding shares/i), '100000');
    expect(useBtn).toBeEnabled();
  });

  it('"Use this value" writes the computed value into currentFmv', async () => {
    const user = userEvent.setup();
    setupForm();
    await user.click(screen.getByText(/estimate it from company valuation/i));
    await user.type(screen.getByLabelText(/company valuation/i), '1000000');
    await user.type(screen.getByLabelText(/total debt/i), '0');
    await user.type(screen.getByLabelText(/outstanding shares/i), '100000');
    await user.click(screen.getByRole('button', { name: /use this value/i }));
    expect(
      (screen.getByLabelText(/current fmv/i) as HTMLInputElement).value,
    ).toBe('10');
  });

  it('shows over-leveraged warning when debt > valuation', async () => {
    const user = userEvent.setup();
    setupForm();
    await user.click(screen.getByText(/estimate it from company valuation/i));
    await user.type(screen.getByLabelText(/company valuation/i), '1000000');
    await user.type(screen.getByLabelText(/total debt/i), '2000000');
    await user.type(screen.getByLabelText(/outstanding shares/i), '100000');
    expect(
      await screen.findByText(/total debt exceeds company valuation/i),
    ).toBeInTheDocument();
  });

  it('submits the three calculator fields with the rest of the grant', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    setupForm({ onSubmit });

    // Fill required base fields (radio for owner picker)
    await user.type(screen.getByLabelText(/^name$/i), '2024 RSU grant');
    await user.type(screen.getByLabelText(/^company$/i), 'Acme Corp');
    await user.click(screen.getByRole('radio', { name: /^alice$/i }));
    await selectDate(user, 'grant-date', '2024-01-15');
    // strikePrice already 0 from defaults; totalShares + currentFmv default to 0 — set non-zero
    const sharesInput = screen.getByLabelText(/total shares/i);
    await user.clear(sharesInput);
    await user.type(sharesInput, '1000');
    const fmvInput = screen.getByLabelText(/current fmv/i);
    await user.clear(fmvInput);
    await user.type(fmvInput, '50');
    // Vesting row's date — use the helper. The default vesting schedule has
    // one row with empty date; cumulativePct already 1.0.
    await selectDate(user, 'vesting-row-0-date', '2027-01-15');

    // Open calculator and fill it.
    await user.click(screen.getByText(/estimate it from company valuation/i));
    await user.type(screen.getByLabelText(/company valuation/i), '10000000');
    await user.type(screen.getByLabelText(/total debt/i), '2000000');
    await user.type(screen.getByLabelText(/outstanding shares/i), '5000000');

    await user.click(screen.getByRole('button', { name: /^save$/i }));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled(), { timeout: 10_000 });
    const submitted = onSubmit.mock.calls[0][0] as EquityGrantFormValues;
    expect(submitted.companyValuation).toBe(10_000_000);
    expect(submitted.companyTotalDebt).toBe(2_000_000);
    expect(submitted.companyOutstandingShares).toBe(5_000_000);
  }, 15000);
  // ↑ 15s + explicit 10s vi.waitFor timeout — 14+ sequential user-events
  // (including 2 selectDate helpers = 6 events) routinely cross the
  // default 5s envelope under full-suite parallelism (wave3 N1).

  it('clearing a calculator input blanks the per-share preview but keeps currentFmv unchanged', async () => {
    const user = userEvent.setup();
    setupForm({
      initial: {
        currentFmv: 10,
        companyValuation: 1_000_000,
        companyOutstandingShares: 100_000,
        companyTotalDebt: 0,
      },
    });
    // Edit mode: calculator already open. Preview shows $10.00.
    expect(await screen.findByText('$10.00', undefined, { timeout: 5000 })).toBeInTheDocument();
    const sharesInput = screen.getByLabelText(/outstanding shares/i);
    await user.clear(sharesInput);
    // Per-share blanks to a placeholder dash. findByText defaults to 1s
    // timeout which is tight under full-suite parallelism; 5s budget
    // matches wave3 N1 budget reasoning.
    expect(await screen.findByText('—', undefined, { timeout: 5000 })).toBeInTheDocument();
    // currentFmv unchanged:
    expect((screen.getByLabelText(/current fmv/i) as HTMLInputElement).value).toBe('10');
  });
});

describe('EquityGrantForm — DEFAULT_EQUITY_GRANT', () => {
  it('has the three calculator fields defaulting to null', () => {
    expect(DEFAULT_EQUITY_GRANT.companyValuation).toBeNull();
    expect(DEFAULT_EQUITY_GRANT.companyOutstandingShares).toBeNull();
    expect(DEFAULT_EQUITY_GRANT.companyTotalDebt).toBeNull();
  });
});
