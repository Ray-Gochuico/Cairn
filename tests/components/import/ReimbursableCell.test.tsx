import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReimbursableCell } from '@/components/import/ReimbursableCell';

describe('ReimbursableCell', () => {
  it('renders a select with Yes / No / — options', () => {
    render(<ReimbursableCell value="" onChange={vi.fn()} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    const texts = Array.from(select.options).map((o) => o.text);
    expect(texts).toContain('Yes');
    expect(texts).toContain('No');
  });

  it('normalizes yes/true/1/y to true and pre-selects it', () => {
    render(<ReimbursableCell value="yes" onChange={vi.fn()} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('true');
  });

  it('normalizes no/false/0/n to false and pre-selects it', () => {
    render(<ReimbursableCell value="no" onChange={vi.fn()} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('false');
  });

  it('calls onChange with true/false on selection', () => {
    const onChange = vi.fn();
    render(<ReimbursableCell value="" onChange={onChange} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'true' } });
    expect(onChange).toHaveBeenCalledWith('true');
  });
});
