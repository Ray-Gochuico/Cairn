import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OwnerPersonCell } from '@/components/import/OwnerPersonCell';

describe('OwnerPersonCell', () => {
  const PERSONS = [
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' },
  ];

  it('renders a native select with all persons + an "(none — joint)" option', () => {
    render(<OwnerPersonCell value={null} persons={PERSONS} onChange={() => {}} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.options.length).toBe(3); // joint + 2 persons
  });

  it('renders the selected person id', () => {
    render(<OwnerPersonCell value={2} persons={PERSONS} onChange={() => {}} />);
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('2');
  });

  it('calls onChange(null) when (none) is picked', () => {
    const onChange = vi.fn();
    render(<OwnerPersonCell value={1} persons={PERSONS} onChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('calls onChange(id) when a person is picked', () => {
    const onChange = vi.fn();
    render(<OwnerPersonCell value={null} persons={PERSONS} onChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2' } });
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('renders the error message when `error` is set', () => {
    render(
      <OwnerPersonCell
        value={null}
        persons={PERSONS}
        onChange={() => {}}
        error={{ field: 'owner_person_name', message: 'No person named X' }}
      />,
    );
    expect(screen.getByText(/No person named X/)).toBeInTheDocument();
  });
});
