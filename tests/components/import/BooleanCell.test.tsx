import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BooleanCell } from '@/components/import/BooleanCell';

describe('BooleanCell', () => {
  it('renders an unchecked checkbox for false', () => {
    render(<BooleanCell value={false} onChange={() => {}} />);
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  });

  it('renders a checked checkbox for true', () => {
    render(<BooleanCell value={true} onChange={() => {}} />);
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  });

  it('calls onChange with the new value when toggled', () => {
    const onChange = vi.fn();
    render(<BooleanCell value={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('renders the error message when `error` is set', () => {
    render(
      <BooleanCell
        value={false}
        onChange={() => {}}
        error={{ field: 'excluded_from_net_worth', message: 'Invalid boolean' }}
      />,
    );
    expect(screen.getByText(/Invalid boolean/)).toBeInTheDocument();
  });
});
