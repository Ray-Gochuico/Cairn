import { render, screen, fireEvent } from '@testing-library/react';
import { NumberField } from '@/components/calculators/NumberField';

describe('NumberField', () => {
  it('renders a labeled input with the value', () => {
    render(<NumberField id="years" label="Years to retirement" value={20} onChange={() => {}} />);
    expect((screen.getByLabelText('Years to retirement') as HTMLInputElement).value).toBe('20');
  });

  it('emits null when cleared (blankable — no coercion to 0)', () => {
    const onChange = vi.fn();
    render(<NumberField id="years" label="Years to retirement" value={20} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Years to retirement'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('emits a parsed number on input', () => {
    const onChange = vi.fn();
    render(<NumberField id="years" label="Years to retirement" value={20} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Years to retirement'), { target: { value: '12' } });
    expect(onChange).toHaveBeenCalledWith(12);
  });

  describe('min clamp-on-change', () => {
    it('clamps a sub-min value up to min (min=0, input=-5 → emits 0)', () => {
      const onChange = vi.fn();
      render(<NumberField id="amount" label="Amount" value={0} onChange={onChange} min={0} />);
      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '-5' } });
      expect(onChange).toHaveBeenCalledWith(0);
    });

    it('passes through a value at the min unchanged (min=0, input=0 → emits 0)', () => {
      const onChange = vi.fn();
      render(<NumberField id="amount" label="Amount" value={5} onChange={onChange} min={0} />);
      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '0' } });
      expect(onChange).toHaveBeenCalledWith(0);
    });

    it('passes through a value above the min unchanged (min=0, input=10 → emits 10)', () => {
      const onChange = vi.fn();
      render(<NumberField id="amount" label="Amount" value={5} onChange={onChange} min={0} />);
      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '10' } });
      expect(onChange).toHaveBeenCalledWith(10);
    });

    it('clamps to min=1 when input=0', () => {
      const onChange = vi.fn();
      render(<NumberField id="qty" label="Quantity" value={1} onChange={onChange} min={1} />);
      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '0' } });
      expect(onChange).toHaveBeenCalledWith(1);
    });

    it('empty string → null even when min is set', () => {
      const onChange = vi.fn();
      render(<NumberField id="amount" label="Amount" value={5} onChange={onChange} min={0} />);
      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '' } });
      expect(onChange).toHaveBeenCalledWith(null);
    });

    it('no clamp when min is not provided (negative values pass through)', () => {
      const onChange = vi.fn();
      render(<NumberField id="delta" label="Delta" value={0} onChange={onChange} />);
      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '-5' } });
      expect(onChange).toHaveBeenCalledWith(-5);
    });
  });
});
