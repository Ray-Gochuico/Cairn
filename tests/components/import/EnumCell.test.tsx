import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EnumCell } from '@/components/import/EnumCell';

describe('EnumCell', () => {
  const OPTIONS = ['CHECKING', 'SAVINGS', 'BROKERAGE'];

  it('renders a native select with the supplied options', () => {
    render(<EnumCell value="CHECKING" options={OPTIONS} onChange={() => {}} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('CHECKING');
    expect(select.options).toHaveLength(3);
  });

  it('calls onChange with the new value when the user selects', () => {
    const onChange = vi.fn();
    render(<EnumCell value="CHECKING" options={OPTIONS} onChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'SAVINGS' } });
    expect(onChange).toHaveBeenCalledWith('SAVINGS');
  });

  it('renders the error message when `error` prop is set', () => {
    render(
      <EnumCell
        value=""
        options={OPTIONS}
        onChange={() => {}}
        error={{ field: 'type', message: 'Unknown type' }}
      />,
    );
    expect(screen.getByText(/Unknown type/)).toBeInTheDocument();
  });
});
