import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Person } from '@/types/schema';
import { useDependentsStore } from '@/stores/dependents-store';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import Section1_WhoYouAre from '@/pages/setup/Section1_WhoYouAre';

function resetStores() {
  useHouseholdStore.setState({
    household: null,
    isLoading: false,
    error: null,
    load: async () => {},
    update: async () => {},
    acceptDisclaimer: async () => {},
  } as any);
  usePersonsStore.setState({
    persons: [],
    isLoading: false,
    error: null,
    load: async () => {},
    create: async () => 1,
    update: async () => {},
    remove: async () => {},
  } as any);
  useDependentsStore.setState({
    dependents: [],
    isLoading: false,
    error: null,
    load: async () => {},
    create: async () => 1,
    update: async () => {},
    remove: async () => {},
  } as any);
  useTaxRulesStore.setState({
    items: [],
    isLoading: false,
    error: null,
    loadYear: async () => {},
  } as any);
}

describe('Section1_WhoYouAre', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders the entry gate when status is pending', () => {
    render(
      <Section1_WhoYouAre status="pending" onSetStatus={() => {}} />,
    );
    expect(
      screen.getByText(/Tell us about your household/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /start this section/i }),
    ).toBeInTheDocument();
  });

  it('renders the four cards when status is in_progress', () => {
    render(
      <Section1_WhoYouAre status="in_progress" onSetStatus={() => {}} />,
    );
    expect(screen.getByText(/^Household$/)).toBeInTheDocument();
    expect(screen.getByText(/^Persons$/)).toBeInTheDocument();
    expect(screen.getByText(/^Employment$/)).toBeInTheDocument();
    expect(screen.getByText(/^Dependents$/)).toBeInTheDocument();
  });

  it('clicking Start this section flips status to in_progress', async () => {
    const user = userEvent.setup();
    const onSetStatus = vi.fn();
    render(
      <Section1_WhoYouAre status="pending" onSetStatus={onSetStatus} />,
    );
    await user.click(
      screen.getByRole('button', { name: /start this section/i }),
    );
    expect(onSetStatus).toHaveBeenCalledWith('in_progress');
  });

  it('clicking Skip flips status to skipped', async () => {
    const user = userEvent.setup();
    const onSetStatus = vi.fn();
    render(
      <Section1_WhoYouAre status="pending" onSetStatus={onSetStatus} />,
    );
    await user.click(screen.getByRole('button', { name: /skip/i }));
    expect(onSetStatus).toHaveBeenCalledWith('skipped');
  });

  it('shows the "wasSkipped" hint when status is skipped', () => {
    render(
      <Section1_WhoYouAre status="skipped" onSetStatus={() => {}} />,
    );
    expect(
      screen.getByText(/you skipped this section earlier/i),
    ).toBeInTheDocument();
  });

  it('counts an HOURLY person (hourlyRate > 0, no salary) as employed (M1)', () => {
    const hourly = {
      id: 1,
      name: 'Hank',
      annualSalaryPretax: 0,
      hourlyRate: 30,
    } as unknown as Person;
    usePersonsStore.setState({
      persons: [hourly],
      isLoading: false,
      error: null,
      load: async () => {},
      create: async () => 1,
      update: async () => {},
      remove: async () => {},
    } as never);
    render(<Section1_WhoYouAre status="in_progress" onSetStatus={() => {}} />);
    const employmentHeading = screen.getByText(/^Employment$/);
    const employmentCard = employmentHeading.closest('div[class*="rounded"]');
    expect(employmentCard).not.toBeNull();
    // The card must read "1 added", not "0 added".
    expect(
      within(employmentCard as HTMLElement).getByText(/1 added/i),
    ).toBeInTheDocument();
  });

  it('T23: renders each added person as a chip', () => {
    usePersonsStore.setState({
      persons: [
        { id: 1, name: 'Alice', annualSalaryPretax: 0, hourlyRate: null } as unknown as Person,
        { id: 2, name: 'Bob', annualSalaryPretax: 0, hourlyRate: null } as unknown as Person,
      ],
      isLoading: false, error: null, load: async () => {}, create: async () => 1,
      update: async () => {}, remove: async () => {},
    } as never);
    render(<Section1_WhoYouAre status="in_progress" onSetStatus={() => {}} />);
    const chips = screen.getByTestId('person-chips');
    expect(within(chips).getByText('Alice')).toBeInTheDocument();
    expect(within(chips).getByText('Bob')).toBeInTheDocument();
    expect(within(chips).getByRole('button', { name: /edit alice/i })).toBeInTheDocument();
    expect(within(chips).getByRole('button', { name: /remove bob/i })).toBeInTheDocument();
  });

  it('T23: Edit on a chip opens the person dialog pre-filled with the name', async () => {
    const user = userEvent.setup();
    usePersonsStore.setState({
      persons: [{ id: 1, name: 'Alice', dateOfBirth: '1990-01-01', annualSalaryPretax: 0, hourlyRate: null } as unknown as Person],
      isLoading: false, error: null, load: async () => {}, create: async () => 1,
      update: async () => {}, remove: async () => {},
    } as never);
    render(<Section1_WhoYouAre status="in_progress" onSetStatus={() => {}} />);
    await user.click(screen.getByRole('button', { name: /edit alice/i }));
    expect(await screen.findByRole('heading', { name: /edit person/i })).toBeInTheDocument();
    expect((screen.getByLabelText(/name/i) as HTMLInputElement).value).toBe('Alice');
  });

  it('T23: Remove on a chip confirms then calls remove(id)', async () => {
    const user = userEvent.setup();
    const remove = vi.fn().mockResolvedValue(undefined);
    usePersonsStore.setState({
      persons: [{ id: 7, name: 'Carol', annualSalaryPretax: 0, hourlyRate: null } as unknown as Person],
      isLoading: false, error: null, load: async () => {}, create: async () => 1,
      update: async () => {}, remove,
    } as never);
    render(<Section1_WhoYouAre status="in_progress" onSetStatus={() => {}} />);
    await user.click(screen.getByRole('button', { name: /remove carol/i }));
    // Confirm in the house ConfirmDialog.
    const confirmBtn = await screen.findByRole('button', { name: /^(remove|confirm|delete)/i });
    await user.click(confirmBtn);
    expect(remove).toHaveBeenCalledWith(7);
  });

  it('clicking Add manually on the Persons card opens the PersonForm dialog', async () => {
    const user = userEvent.setup();
    render(
      <Section1_WhoYouAre status="in_progress" onSetStatus={() => {}} />,
    );
    // Find the Persons card; multiple cards have Add manually buttons.
    const personsHeading = screen.getByText(/^Persons$/);
    const personsCard = personsHeading.closest('div[class*="rounded"]');
    expect(personsCard).not.toBeNull();
    const addBtn = within(personsCard as HTMLElement).getByRole('button', {
      name: /add manually/i,
    });
    await user.click(addBtn);
    // PersonForm renders the Add Person submit button inside the Dialog.
    expect(
      await screen.findByRole('button', { name: /add person/i }),
    ).toBeInTheDocument();
  });
});
