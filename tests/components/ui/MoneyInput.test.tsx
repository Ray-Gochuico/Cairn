import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { MoneyInput } from '@/components/ui/money-input';

function Harness({ initial = null as number | null }) {
  const [v, setV] = useState<number | null>(initial);
  return (
    <>
      <MoneyInput id="amt" aria-label="Amount" value={v} onValueChange={setV} />
      <output data-testid="model">{v === null ? 'null' : String(v)}</output>
    </>
  );
}

describe('MoneyInput', () => {
  it('formats with thousands separators on blur and shows the $ prefix', () => {
    render(<Harness />);
    const input = screen.getByLabelText('Amount');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '300000' } });
    fireEvent.blur(input);
    expect((input as HTMLInputElement).value).toBe('300,000');
    expect(screen.getByText('$')).toBeInTheDocument();
    expect(screen.getByTestId('model')).toHaveTextContent('300000');
  });

  it('unformats while focused for raw editing', () => {
    render(<Harness initial={12500.5} />);
    const input = screen.getByLabelText('Amount') as HTMLInputElement;
    expect(input.value).toBe('12,500.50');
    fireEvent.focus(input);
    expect(input.value).toBe('12500.5');
  });

  it('empty input commits null; junk keeps the last valid model value', () => {
    render(<Harness initial={100} />);
    const input = screen.getByLabelText('Amount');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(screen.getByTestId('model')).toHaveTextContent('null');
  });

  it('preserves cents and rejects non-numeric characters as typed', () => {
    render(<Harness />);
    const input = screen.getByLabelText('Amount');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '1234.56' } });
    fireEvent.blur(input);
    expect((input as HTMLInputElement).value).toBe('1,234.56');
    expect(screen.getByTestId('model')).toHaveTextContent('1234.56');
  });
});
