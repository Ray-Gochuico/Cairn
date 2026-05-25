import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AccountCell } from '@/components/import/AccountCell';

const accounts = [
  { id: 1, name: 'Fidelity 401k' },
  { id: 2, name: 'Vanguard' },
];

describe('AccountCell', () => {
  it('renders display mode showing the value when no error', () => {
    render(<AccountCell value="Fidelity 401k" accounts={accounts} onChange={vi.fn()} />);
    expect(screen.getByText('Fidelity 401k')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('renders a dropdown when error is set', () => {
    render(<AccountCell value="Unknown" error={{ field: 'account', message: 'No account named "Unknown"' }} accounts={accounts} onChange={vi.fn()} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('dropdown options include all accounts', () => {
    render(<AccountCell value="Unknown" error={{ field: 'account', message: 'bad' }} accounts={accounts} onChange={vi.fn()} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    const optionTexts = Array.from(select.options).map((o) => o.text);
    expect(optionTexts).toContain('Fidelity 401k');
    expect(optionTexts).toContain('Vanguard');
  });

  it('calls onChange with the chosen account name on selection', () => {
    const onChange = vi.fn();
    render(<AccountCell value="Unknown" error={{ field: 'account', message: 'bad' }} accounts={accounts} onChange={onChange} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'Vanguard' } });
    expect(onChange).toHaveBeenCalledWith('Vanguard');
  });

  it('switches to input mode on click in display mode', () => {
    render(<AccountCell value="Fidelity 401k" accounts={accounts} onChange={vi.fn()} />);
    fireEvent.click(screen.getByText('Fidelity 401k'));
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});
