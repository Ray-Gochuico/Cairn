import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AssetClass } from '@/types/enums';
import { AssetClassTargetsForm } from '@/components/investments/AssetClassTargetsForm';

function renderForm(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('AssetClassTargetsForm', () => {
  it('surfaces only held classes and shows a running sum-to-100% indicator', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderForm(
      <AssetClassTargetsForm
        heldClasses={[AssetClass.US_TOTAL_MARKET, AssetClass.US_BONDS]}
        initial={[{ assetClass: AssetClass.US_TOTAL_MARKET, targetPct: 0.6 }]}
        onSave={onSave}
      />,
    );
    // A class the user does NOT hold must not appear.
    expect(screen.queryByText(/Emerging Markets/i)).toBeNull();
    expect(screen.getByText('US Total Market')).toBeInTheDocument();
    expect(screen.getByText('US Bonds')).toBeInTheDocument();
    // Running sum reflects 60% (US_TOTAL_MARKET set, US_BONDS unset/0).
    expect(screen.getByTestId('class-targets-sum')).toHaveTextContent('60');
  });

  it('blocks save when the running sum exceeds 100%', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderForm(
      <AssetClassTargetsForm
        heldClasses={[AssetClass.US_TOTAL_MARKET]}
        initial={[{ assetClass: AssetClass.US_TOTAL_MARKET, targetPct: 0.6 }]}
        onSave={onSave}
      />,
    );
    const input = screen.getByLabelText(/US Total Market target/i);
    await user.clear(input);
    await user.type(input, '120');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/100%/);
  });

  it('saves the fractions (÷100 from whole-percent inputs)', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderForm(
      <AssetClassTargetsForm
        heldClasses={[AssetClass.US_TOTAL_MARKET, AssetClass.US_BONDS]}
        initial={null}
        onSave={onSave}
      />,
    );
    await user.type(screen.getByLabelText(/US Total Market target/i), '60');
    await user.type(screen.getByLabelText(/US Bonds target/i), '40');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(onSave).toHaveBeenCalledWith([
      { assetClass: AssetClass.US_TOTAL_MARKET, targetPct: 0.6 },
      { assetClass: AssetClass.US_BONDS, targetPct: 0.4 },
    ]);
  });

  it('renders a reciprocal link to the Calculators allocator (UX H1)', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderForm(
      <AssetClassTargetsForm
        heldClasses={[AssetClass.US_TOTAL_MARKET]}
        initial={null}
        onSave={onSave}
      />,
    );
    const link = screen.getByRole('link', { name: /allocate a contribution/i });
    expect(link).toHaveAttribute('href', '/calculators');
  });
});
