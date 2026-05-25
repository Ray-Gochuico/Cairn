import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ValueCell } from '@/components/import/ValueCell';

describe('ValueCell', () => {
  it('renders display mode by default', () => {
    render(<ValueCell value="60000" onChange={vi.fn()} />);
    expect(screen.getByText('60000')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('renders input mode when error is set', () => {
    render(<ValueCell value="abc" error={{ field: 'total_value', message: 'Value must be numeric' }} onChange={vi.fn()} />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('calls onChange on blur with the new value', () => {
    const onChange = vi.fn();
    render(<ValueCell value="abc" error={{ field: 'total_value', message: 'bad' }} onChange={onChange} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '60000' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith('60000');
  });

  it('switches to input mode on click in display mode', () => {
    render(<ValueCell value="60000" onChange={vi.fn()} />);
    fireEvent.click(screen.getByText('60000'));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('shows the error message under the input', () => {
    render(<ValueCell value="abc" error={{ field: 'total_value', message: 'Value must be numeric' }} onChange={vi.fn()} />);
    expect(screen.getByText(/value must be numeric/i)).toBeInTheDocument();
  });
});
