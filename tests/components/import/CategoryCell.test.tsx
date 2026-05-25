import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CategoryCell } from '@/components/import/CategoryCell';

const categories = [
  { id: 1, name: 'Groceries' },
  { id: 2, name: 'Travel' },
];

describe('CategoryCell', () => {
  it('renders display mode by default', () => {
    render(<CategoryCell value="Groceries" categories={categories} onChange={vi.fn()} />);
    expect(screen.getByText('Groceries')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('renders a dropdown when error is set', () => {
    render(<CategoryCell value="Bogus" error={{ field: 'category', message: 'no such category' }} categories={categories} onChange={vi.fn()} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('dropdown includes all categories and a (none) option', () => {
    render(<CategoryCell value="" error={{ field: 'category', message: 'bad' }} categories={categories} onChange={vi.fn()} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    const texts = Array.from(select.options).map((o) => o.text);
    expect(texts).toContain('Groceries');
    expect(texts).toContain('Travel');
    expect(texts.some((t) => /none/i.test(t))).toBe(true);
  });

  it('calls onChange with the chosen category name on selection', () => {
    const onChange = vi.fn();
    render(<CategoryCell value="" error={{ field: 'category', message: 'bad' }} categories={categories} onChange={onChange} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'Travel' } });
    expect(onChange).toHaveBeenCalledWith('Travel');
  });
});
