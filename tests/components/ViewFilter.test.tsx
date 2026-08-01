import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { usePersonsStore } from '@/stores/persons-store';
import { ViewFilter } from '@/components/layout/ViewFilter';

const TWO_PERSONS = [
  {
    id: 1,
    householdId: 1,
    name: 'Alice',
    dateOfBirth: '1990-01-01',
    targetRetirementAge: 65,
    annualSalaryPretax: 100000,
    expectedBonus: 0,
    expectedBonusFrequency: 'ANNUAL' as const,
    bonusIsConsistent: true,
    expectedCommission: 0,
    expectedCommissionFrequency: 'MONTHLY' as const,
    pretax401kPct: 0,
    healthInsuranceMonthlyPremium: 0,
    dependentCareFsaMonthly: 0,
    hsaMonthlyContribution: 0,
    hsaEligible: false,
  },
  {
    id: 2,
    householdId: 1,
    name: 'Bob',
    dateOfBirth: '1992-06-15',
    targetRetirementAge: 65,
    annualSalaryPretax: 90000,
    expectedBonus: 0,
    expectedBonusFrequency: 'ANNUAL' as const,
    bonusIsConsistent: true,
    expectedCommission: 0,
    expectedCommissionFrequency: 'MONTHLY' as const,
    pretax401kPct: 0,
    healthInsuranceMonthlyPremium: 0,
    dependentCareFsaMonthly: 0,
    hsaMonthlyContribution: 0,
    hsaEligible: false,
  },
];

function resetStore() {
  usePersonsStore.setState({ persons: [], isLoading: false, error: null });
}

describe('ViewFilter', () => {
  beforeEach(() => {
    resetStore();
  });

  it('renders nothing when only 1 person (isAvailable === false)', () => {
    usePersonsStore.setState({ persons: [TWO_PERSONS[0]], isLoading: false, error: null });
    const { container } = render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <ViewFilter />
      </MemoryRouter>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders dropdown with 4 options when 2 persons exist', () => {
    usePersonsStore.setState({ persons: TWO_PERSONS, isLoading: false, error: null });
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <ViewFilter />
      </MemoryRouter>,
    );

    const select = screen.getByRole('combobox', { name: /filter view by person/i });
    expect(select).toBeInTheDocument();

    const options = select.querySelectorAll('option');
    expect(options).toHaveLength(4);
    expect(options[0].value).toBe('household');
    expect(options[1].value).toBe('p1');
    expect(options[1].textContent).toBe('Alice');
    expect(options[2].value).toBe('p2');
    expect(options[2].textContent).toBe('Bob');
    expect(options[3].value).toBe('joint');
  });

  it('renders nothing when route starts with /inputs/', () => {
    usePersonsStore.setState({ persons: TWO_PERSONS, isLoading: false, error: null });
    const { container } = render(
      <MemoryRouter initialEntries={['/inputs/persons']}>
        <ViewFilter />
      </MemoryRouter>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when route starts with /setup', () => {
    usePersonsStore.setState({ persons: TWO_PERSONS, isLoading: false, error: null });
    const { container } = render(
      <MemoryRouter initialEntries={['/setup/wizard']}>
        <ViewFilter />
      </MemoryRouter>,
    );
    expect(container.firstChild).toBeNull();
  });

  function renderViewFilterAt(path: string) {
    usePersonsStore.setState({ persons: TWO_PERSONS, isLoading: false, error: null });
    return render(
      <MemoryRouter initialEntries={[path]}>
        <ViewFilter />
      </MemoryRouter>,
    );
  }

  it.each(['/settings', '/learn', '/what-if', '/roadmap', '/inputs', '/setup'])(
    'Wave A D3: hides the dropdown on %s',
    (path) => {
      renderViewFilterAt(path);
      expect(screen.queryByRole('combobox', { name: 'Filter view by person' })).not.toBeInTheDocument();
    },
  );
  it.each(['/', '/loans', '/monthly', '/budget'])('still renders on %s', (path) => {
    renderViewFilterAt(path);
    expect(screen.getByRole('combobox', { name: 'Filter view by person' })).toBeInTheDocument();
  });

  it('Wave B D-B12: hides the header copy on exactly /calculators (the bar owns the control there)', () => {
    renderViewFilterAt('/calculators');
    expect(screen.queryByRole('combobox', { name: 'Filter view by person' })).not.toBeInTheDocument();
  });
  it("Wave B D-B12: still renders on /calculators/backtest (it IS that page's scope control)", () => {
    renderViewFilterAt('/calculators/backtest');
    expect(screen.getByRole('combobox', { name: 'Filter view by person' })).toBeInTheDocument();
  });
  it('Wave B D-B12: hides on /calculators/paycheck (household-only page)', () => {
    renderViewFilterAt('/calculators/paycheck');
    expect(screen.queryByRole('combobox', { name: 'Filter view by person' })).not.toBeInTheDocument();
  });

  it('changing the select updates the URL search param', () => {
    usePersonsStore.setState({ persons: TWO_PERSONS, isLoading: false, error: null });

    // Probe component to capture search params
    let capturedParams: URLSearchParams | null = null;
    function ParamsProbe() {
      const [params] = useSearchParams();
      capturedParams = params;
      return null;
    }

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <ViewFilter />
        <ParamsProbe />
      </MemoryRouter>,
    );

    const select = screen.getByRole('combobox', { name: /filter view by person/i });
    fireEvent.change(select, { target: { value: 'p1' } });

    expect(capturedParams!.get('view')).toBe('p1');
  });
});
