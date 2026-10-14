import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Section1_WhoYouAre from '@/pages/setup/Section1_WhoYouAre';
import { useDependentsStore } from '@/stores/dependents-store';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import type { Person } from '@/types/schema';
import { makeHousehold, makePerson } from '../../factories';

/**
 * v1.8.0 O2 (RC2 variant, CR-O-3): in the form-view Employment dialog, one
 * person's Save never discards another person's unsaved entries. Before,
 * EmploymentSection called onSaved after the FIRST person's save and
 * Section 1 closed the dialog on it (EmploymentSection.tsx:93-94,
 * Section1_WhoYouAre.tsx:224), so person 2's typing was gone.
 */

const update = vi.fn(async (id: number, patch: Partial<Person>) => {
  usePersonsStore.setState((s) => ({
    persons: s.persons.map((p) => (p.id === id ? { ...p, ...patch } : p)),
  }));
});

function seedPersons(persons: Person[]) {
  usePersonsStore.setState({
    persons, isLoading: false, error: null,
    load: async () => {}, create: async () => 1, update, remove: async () => {},
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  useHouseholdStore.setState({
    household: makeHousehold(), isLoading: false, error: null,
    load: async () => {}, update: async () => {}, acceptDisclaimer: async () => {},
  } as never);
  useDependentsStore.setState({ dependents: [], isLoading: false, error: null, load: async () => {} } as never);
  useTaxRulesStore.setState({ items: [], isLoading: false, error: null, loadYear: async () => {} } as never);
});

const salaried = (id: number, name: string) =>
  makePerson({ id, name, employmentType: 'SALARY_NO_OT', annualSalaryPretax: 0 });

async function openEmployment() {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <Section1_WhoYouAre hasData settled status="in_progress" onSetStatus={() => {}} />
    </MemoryRouter>,
  );
  await user.click(within(screen.getByTestId('entity-card-employment')).getByRole('button', { name: 'Add manually' }));
  const dialog = await screen.findByRole('dialog', { name: 'Employment' });
  const salary = (id: number) => within(dialog).getByLabelText('Annual salary (pre-tax)', { selector: `#annualSalaryPretax-${id}` }) as HTMLInputElement;
  const save = (id: number) => within(within(dialog).getByTestId(`employment-card-${id}`)).getByRole('button', { name: 'Save' });
  return { user, salary, save };
}

describe('Section 1 Employment dialog — one Save per person (CR-O-3)', () => {
  it("person 1's Save keeps the dialog open with person 2's unsaved salary; person 2's Save then closes it", async () => {
    seedPersons([salaried(1, 'Alice'), salaried(2, 'Bob')]);
    const { user, salary, save } = await openEmployment();
    await user.clear(salary(2));
    await user.type(salary(2), '88000');
    await user.clear(salary(1));
    await user.type(salary(1), '120000');
    await user.click(save(1));
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenLastCalledWith(1, expect.objectContaining({ annualSalaryPretax: 120000 }));
    expect(screen.getByRole('dialog', { name: 'Employment' })).toBeInTheDocument();
    expect(salary(2).value).toBe('88000');
    await user.click(save(2));
    expect(update).toHaveBeenLastCalledWith(2, expect.objectContaining({ annualSalaryPretax: 88000 }));
    expect(screen.queryByRole('dialog', { name: 'Employment' })).toBeNull();
  });

  it("two people, only person 1 edited: person 1's Save closes the dialog, nothing else being unsaved", async () => {
    seedPersons([salaried(1, 'Alice'), salaried(2, 'Bob')]);
    const { user, salary, save } = await openEmployment();
    await user.clear(salary(1));
    await user.type(salary(1), '120000');
    await user.click(save(1));
    expect(update).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Employment' })).toBeNull();
  });

  it("the person just saved never counts as unsaved, even before the store re-reads their row", async () => {
    seedPersons([salaried(1, 'Alice'), salaried(2, 'Bob')]);
    update.mockImplementationOnce(async () => {});
    const { user, salary, save } = await openEmployment();
    await user.clear(salary(1));
    await user.type(salary(1), '120000');
    await user.click(save(1));
    expect(update).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Employment' })).toBeNull();
  });

  it.each([
    { field: 'employment type', edit: async (user: ReturnType<typeof userEvent.setup>) => user.selectOptions(screen.getByLabelText('Employment type', { selector: '#employmentType-2' }), 'SALARY_NO_OT') },
    { field: 'hourly rate', edit: async (user: ReturnType<typeof userEvent.setup>) => user.type(screen.getByLabelText('Hourly rate', { selector: '#hourlyRate-2' }), '5') },
    { field: 'regular hours', edit: async (user: ReturnType<typeof userEvent.setup>) => user.type(screen.getByLabelText('Regular hours / week', { selector: '#regularHoursPerWeek-2' }), '5') },
    { field: 'OT threshold', edit: async (user: ReturnType<typeof userEvent.setup>) => user.type(screen.getByLabelText('OT threshold (hrs / week)', { selector: '#otThresholdHoursPerWeek-2' }), '5') },
  ])("person 2's unsaved $field keeps the dialog open through person 1's Save", async ({ edit }) => {
    seedPersons([
      salaried(1, 'Alice'),
      makePerson({ id: 2, name: 'Bob', employmentType: 'SALARY_WITH_OT', annualSalaryPretax: 90000, hourlyRate: 30, regularHoursPerWeek: 40, otThresholdHoursPerWeek: 40 }),
    ]);
    const { user, salary, save } = await openEmployment();
    await edit(user);
    await user.clear(salary(1));
    await user.type(salary(1), '120000');
    await user.click(save(1));
    expect(update).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog', { name: 'Employment' })).toBeInTheDocument();
  });

  it("a save the store normalises (person 1 switched to Hourly, its hidden salary stored as 0) never holds the dialog open after everyone is saved", async () => {
    seedPersons([
      makePerson({ id: 1, name: 'Alice', employmentType: 'SALARY_NO_OT', annualSalaryPretax: 85000 }),
      salaried(2, 'Bob'),
    ]);
    const { user, salary, save } = await openEmployment();
    await user.clear(salary(2));
    await user.type(salary(2), '88000');
    await user.selectOptions(screen.getByLabelText('Employment type', { selector: '#employmentType-1' }), 'HOURLY');
    await user.type(screen.getByLabelText('Hourly rate', { selector: '#hourlyRate-1' }), '50');
    await user.click(save(1));
    expect(update).toHaveBeenLastCalledWith(1, expect.objectContaining({ employmentType: 'HOURLY', annualSalaryPretax: 0 }));
    expect(screen.getByRole('dialog', { name: 'Employment' })).toBeInTheDocument();
    await user.click(save(2));
    expect(update).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog', { name: 'Employment' })).toBeNull();
  });

  it("a saved value typed in another form ('120000.50', stored as 120000.5) counts as saved", async () => {
    seedPersons([salaried(1, 'Alice'), salaried(2, 'Bob')]);
    const { user, salary, save } = await openEmployment();
    await user.clear(salary(2));
    await user.type(salary(2), '88000');
    // A browser keeps the typed trailing zero; user-event would normalise it.
    fireEvent.change(salary(1), { target: { value: '120000.50' } });
    expect(salary(1).value).toBe('120000.50');
    await user.click(save(1));
    expect(update).toHaveBeenLastCalledWith(1, expect.objectContaining({ annualSalaryPretax: 120000.5 }));
    expect(screen.getByRole('dialog', { name: 'Employment' })).toBeInTheDocument();
    await user.click(save(2));
    expect(update).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog', { name: 'Employment' })).toBeNull();
  });

  it("typing into person 2 while person 1's save is still in flight keeps the dialog open", async () => {
    seedPersons([salaried(1, 'Alice'), salaried(2, 'Bob')]);
    let release: () => void = () => {};
    update.mockImplementationOnce(async (id: number, patch: Partial<Person>) => {
      await new Promise<void>((r) => { release = r; });
      usePersonsStore.setState((s) => ({
        persons: s.persons.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      }));
    });
    const { user, salary, save } = await openEmployment();
    await user.clear(salary(1));
    await user.type(salary(1), '120000');
    await user.click(save(1));
    await user.clear(salary(2));
    await user.type(salary(2), '88000');
    await act(async () => { release(); });
    expect(update).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog', { name: 'Employment' })).toBeInTheDocument();
    expect(salary(2).value).toBe('88000');
  });

  it('one person: Save closes the dialog, as before', async () => {
    seedPersons([salaried(1, 'Alice')]);
    const { user, salary, save } = await openEmployment();
    await user.clear(salary(1));
    await user.type(salary(1), '120000');
    await user.click(save(1));
    expect(update).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Employment' })).toBeNull();
  });
});
