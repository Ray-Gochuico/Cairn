import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TickerForm, { DEFAULT_TICKER_FORM, ASSET_CLASS_LABELS } from '@/components/forms/TickerForm';
import { AssetClass, Direction } from '@/types/schema';

describe('TickerForm (extracted, W14)', () => {
  it('exports the default form values and asset-class labels', () => {
    expect(DEFAULT_TICKER_FORM.ticker).toBe('');
    expect(DEFAULT_TICKER_FORM.leverageFactor).toBe(1.0);
    expect(ASSET_CLASS_LABELS[AssetClass.US_TOTAL_MARKET]).toBe('US Total Market');
  });

  it('renders fields synced from `values` (edit contract)', () => {
    render(
      <TickerForm
        values={{
          ticker: 'VTI',
          name: 'Vanguard Total Stock Market ETF',
          assetClass: AssetClass.US_TOTAL_MARKET,
          leverageFactor: 1,
          direction: Direction.LONG,
          accentColor: null,
          sector: null,
          industry: null,
        }}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        submitLabel="Save"
      />,
    );
    expect(screen.getByLabelText(/ticker symbol/i)).toHaveValue('VTI');
    expect(screen.getByLabelText(/name/i)).toHaveValue('Vanguard Total Stock Market ETF');
    expect(screen.getByLabelText(/asset class/i)).toHaveValue('US_TOTAL_MARKET');
  });

  it('submit calls onSubmit with parsed (uppercased) values', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => {});
    render(<TickerForm onSubmit={onSubmit} onCancel={vi.fn()} submitLabel="Create" />);
    await user.type(screen.getByLabelText(/ticker symbol/i), 'vti');
    await user.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ ticker: 'VTI', assetClass: AssetClass.OTHER, direction: Direction.LONG }),
    );
  });

  it('an empty ticker submit shows the form-error summary (role=alert)', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<TickerForm onSubmit={onSubmit} onCancel={vi.fn()} submitLabel="Create" />);
    // Dirty the form so the submit button enables, but leave ticker empty.
    await user.type(screen.getByLabelText(/name/i), 'No symbol yet');
    await user.click(screen.getByRole('button', { name: /create/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/ticker/i);
    expect(screen.getByLabelText(/ticker symbol/i)).toHaveAttribute('aria-invalid', 'true');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a rejected save lands in the summary, not an unhandled rejection', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => {
      throw new Error('upsert failed');
    });
    render(<TickerForm onSubmit={onSubmit} onCancel={vi.fn()} submitLabel="Create" />);
    await user.type(screen.getByLabelText(/ticker symbol/i), 'VTI');
    await user.click(screen.getByRole('button', { name: /create/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/upsert failed/i);
  });

  it('Cancel calls onCancel', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<TickerForm onSubmit={vi.fn()} onCancel={onCancel} submitLabel="Create" />);
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
