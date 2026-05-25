import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DateCell } from '@/components/import/DateCell';

describe('DateCell', () => {
  it('renders display mode by default', () => {
    render(<DateCell value="2023-06-30" onChange={vi.fn()} />);
    expect(screen.getByText('2023-06-30')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('renders input mode when error is set', () => {
    render(<DateCell value="bad" error={{ field: 'snapshot_date', message: 'bad' }} onChange={vi.fn()} />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('calls onChange on blur with the new value', () => {
    const onChange = vi.fn();
    render(<DateCell value="bad" error={{ field: 'snapshot_date', message: 'bad' }} onChange={onChange} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2023-06-30' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith('2023-06-30');
  });

  it('switches to input mode on click in display mode', () => {
    render(<DateCell value="2023-06-30" onChange={vi.fn()} />);
    fireEvent.click(screen.getByText('2023-06-30'));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('shows the error message under the input', () => {
    render(<DateCell value="bad" error={{ field: 'snapshot_date', message: 'Use YYYY-MM-DD format' }} onChange={vi.fn()} />);
    expect(screen.getByText(/use yyyy-mm-dd format/i)).toBeInTheDocument();
  });
});
