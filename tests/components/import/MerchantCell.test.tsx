import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MerchantCell } from '@/components/import/MerchantCell';

describe('MerchantCell', () => {
  it('renders display mode by default', () => {
    render(<MerchantCell value="AMAZON" onChange={vi.fn()} />);
    expect(screen.getByText('AMAZON')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('renders input mode when error is set', () => {
    render(<MerchantCell value="" error={{ field: 'merchant', message: 'Merchant is required' }} onChange={vi.fn()} />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('calls onChange on blur with the new value', () => {
    const onChange = vi.fn();
    render(<MerchantCell value="" error={{ field: 'merchant', message: 'bad' }} onChange={onChange} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'STARBUCKS' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith('STARBUCKS');
  });

  it('switches to input mode on click in display mode', () => {
    render(<MerchantCell value="AMAZON" onChange={vi.fn()} />);
    fireEvent.click(screen.getByText('AMAZON'));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });
});
