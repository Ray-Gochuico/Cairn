import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import DatePicker from '@/components/ui/DatePicker';

describe('DatePicker group semantics', () => {
  it('exposes a labeled group wrapping contextualized Year/Month/Day selects', () => {
    render(<DatePicker value="2026-07-02" onChange={() => {}} label="Purchase date" />);
    const group = screen.getByRole('group', { name: 'Purchase date' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Purchase date year' })).toHaveValue('2026');
    expect(screen.getByRole('combobox', { name: 'Purchase date month' })).toHaveValue('07');
    expect(screen.getByRole('combobox', { name: 'Purchase date day' })).toHaveValue('02');
  });
  it('falls back to bare Year/Month/Day names without a label', () => {
    render(<DatePicker value="" onChange={() => {}} />);
    expect(screen.getByRole('combobox', { name: 'Year' })).toBeInTheDocument();
  });
});
