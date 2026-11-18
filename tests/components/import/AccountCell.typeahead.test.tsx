/**
 * v1.8.0 W4 (task_90fd839b, from the O1 smoke): keyboard typeahead in an
 * import preview's account cell reaches past the first match.
 *
 * A native select's typeahead picks as each key is typed, and each pick is a
 * change. The cell closed its dropdown on the first change (or, on a row with
 * an account error, as soon as that pick cleared the error), so typing went
 * no further than the first matching account: with "Taxable A" and "Taxable
 * B", "Taxable B" could not be reached by typing. The dropdown now stays
 * while it has focus and closes when focus leaves it. Clock-free.
 */
import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { AccountCell } from '@/components/import/AccountCell';

const accounts = [
  { id: 1, name: 'Taxable A' },
  { id: 2, name: 'Taxable B' },
  { id: 3, name: 'Roth' },
];

function Host({ initial, picks }: { initial: string; picks: string[] }) {
  const [value, setValue] = useState(initial);
  const known = accounts.some((a) => a.name === value);
  return (
    <AccountCell
      value={value}
      accounts={accounts}
      error={known ? undefined : { field: 'account', message: `No account named "${value}".` }}
      onChange={(name) => {
        picks.push(name);
        setValue(name);
      }}
    />
  );
}

describe('AccountCell: the dropdown stays while it has focus (typeahead)', () => {
  it('a pick keeps the focused dropdown open, so the next typed pick lands too', () => {
    const picks: string[] = [];
    render(<Host initial="Roth" picks={picks} />);
    fireEvent.click(screen.getByText('Roth'));
    const select = screen.getByRole('combobox');
    select.focus();
    fireEvent.change(select, { target: { value: 'Taxable A' } });
    expect(select.isConnected).toBe(true);
    fireEvent.change(select, { target: { value: 'Taxable B' } });
    expect(picks).toEqual(['Taxable A', 'Taxable B']);
    expect(select).toHaveValue('Taxable B');
  });

  it('focus leaving the dropdown closes it to the picked account', () => {
    const picks: string[] = [];
    render(<Host initial="Roth" picks={picks} />);
    fireEvent.click(screen.getByText('Roth'));
    const select = screen.getByRole('combobox');
    select.focus();
    fireEvent.change(select, { target: { value: 'Taxable B' } });
    fireEvent.blur(select);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('Taxable B')).toBeInTheDocument();
  });

  it('on a row with an account error, the pick that fixes it keeps the focused dropdown open until focus leaves', () => {
    const picks: string[] = [];
    render(<Host initial="Brokerage X" picks={picks} />);
    const select = screen.getByRole('combobox');
    select.focus();
    fireEvent.change(select, { target: { value: 'Taxable A' } });
    expect(select.isConnected).toBe(true);
    fireEvent.change(select, { target: { value: 'Taxable B' } });
    expect(picks).toEqual(['Taxable A', 'Taxable B']);
    fireEvent.blur(select);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('Taxable B')).toBeInTheDocument();
  });

  it('an account error cleared while the dropdown does not have focus closes it, as before', () => {
    function Reloaded() {
      const [pool, setPool] = useState(accounts);
      return (
        <>
          <AccountCell
            value="Joint"
            accounts={pool}
            error={pool.some((a) => a.name === 'Joint') ? undefined : { field: 'account', message: 'No account named "Joint".' }}
            onChange={() => {}}
          />
          <button type="button" onClick={() => setPool([...accounts, { id: 4, name: 'Joint' }])}>reload</button>
        </>
      );
    }
    render(<Reloaded />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'reload' }));
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('Joint')).toBeInTheDocument();
  });

  it('a pick made while the dropdown does not have focus closes it at once, as before', () => {
    const picks: string[] = [];
    render(<Host initial="Roth" picks={picks} />);
    fireEvent.click(screen.getByText('Roth'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Taxable B' } });
    expect(picks).toEqual(['Taxable B']);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('Taxable B')).toBeInTheDocument();
  });

  it('a blur while the row still has an account error keeps the dropdown', () => {
    render(<Host initial="Brokerage X" picks={[]} />);
    const select = screen.getByRole('combobox');
    select.focus();
    fireEvent.blur(select);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});
