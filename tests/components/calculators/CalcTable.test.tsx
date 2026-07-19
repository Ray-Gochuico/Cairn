import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CalcTable, CalcRow, type CalcColumn } from '@/components/calculators/CalcTable';

const columns: CalcColumn[] = [
  { key: 'name', header: 'Loan' },
  { key: 'interest', header: 'Interest', numeric: true },
];

describe('CalcTable', () => {
  it('renders header cells with the xs uppercase register', () => {
    render(
      <CalcTable columns={columns} testId="calc-table">
        <CalcRow columns={columns} cells={['Car', '$120']} />
      </CalcTable>,
    );
    const headerRow = screen.getByText('Loan').closest('tr');
    expect(headerRow).toHaveClass('text-xs');
    expect(headerRow).toHaveClass('uppercase');
    expect(headerRow).toHaveClass('text-muted-foreground');
    expect(headerRow).toHaveClass('border-b');
  });

  it('right-aligns a numeric column header and its cells with tabular-nums tds', () => {
    render(
      <CalcTable columns={columns}>
        <CalcRow columns={columns} cells={['Car', '$120']} />
      </CalcTable>,
    );
    const th = screen.getByRole('columnheader', { name: 'Interest' });
    expect(th).toHaveClass('text-right');
    const td = screen.getByText('$120');
    expect(td.tagName).toBe('TD');
    expect(td).toHaveClass('text-right');
    expect(td).toHaveClass('tabular-nums');
    // Non-numeric cells are neither right-aligned nor tabular.
    const nameTd = screen.getByText('Car');
    expect(nameTd).not.toHaveClass('text-right');
    expect(nameTd).not.toHaveClass('tabular-nums');
  });

  it('rows carry border-b with last:border-b-0', () => {
    render(
      <CalcTable columns={columns}>
        <CalcRow columns={columns} cells={['Car', '$120']} testId="row-car" />
        <CalcRow columns={columns} cells={['House', '$900']} testId="row-house" />
      </CalcTable>,
    );
    expect(screen.getByTestId('row-car')).toHaveClass('border-b');
    expect(screen.getByTestId('row-car')).toHaveClass('last:border-b-0');
  });

  it('wraps the table in overflow-x-auto and lands testId on the wrapper', () => {
    render(
      <CalcTable columns={columns} testId="calc-table">
        <CalcRow columns={columns} cells={['Car', '$120']} />
      </CalcTable>,
    );
    const wrapper = screen.getByTestId('calc-table');
    expect(wrapper).toHaveClass('overflow-x-auto');
    expect(wrapper.querySelector('table')).not.toBeNull();
  });

  it('subtotal rows carry the muted group-subtotal styling', () => {
    render(
      <CalcTable columns={columns}>
        <CalcRow columns={columns} cells={['Subtotal', '$1,020']} subtotal testId="row-subtotal" />
      </CalcTable>,
    );
    expect(screen.getByTestId('row-subtotal')).toHaveClass('text-muted-foreground');
    expect(screen.getByText('Subtotal')).toHaveClass('font-medium');
  });
});
