import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
