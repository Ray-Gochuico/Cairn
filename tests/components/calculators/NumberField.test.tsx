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
});
