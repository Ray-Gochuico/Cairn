import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useEquityGrantsStore } from '@/stores/equity-grants-store';
import { usePersonsStore } from '@/stores/persons-store';
import type { EquityGrant, Person } from '@/types/schema';
import { EquityValueCard } from '@/pages/calculators/EquityValueCard';

const basePerson: Person = {
  id: 1,
  householdId: 1,
  name: 'Alice',
  dateOfBirth: '1990-01-01',
  targetRetirementAge: 65,
  annualSalaryPretax: 100000,
  expectedBonus: 0,
  expectedBonusFrequency: 'ANNUAL',
  bonusIsConsistent: true,
  expectedCommission: 0,
  expectedCommissionFrequency: 'MONTHLY',
  employmentType: 'SALARY_NO_OT',
  hourlyRate: null,
  regularHoursPerWeek: 40,
  otThresholdHoursPerWeek: 40,
  pretax401kPct: 0,
  healthInsuranceMonthlyPremium: 0,
  dependentCareFsaMonthly: 0,
  hsaMonthlyContribution: 0,
  hsaEligible: false,
};

function resetStores() {
  useEquityGrantsStore.setState({
    equityGrants: [],
    isLoading: false,
    error: null,
  });
  usePersonsStore.setState({
    persons: [],
    isLoading: false,
    error: null,
  });
}

interface PrimeOpts {
  grants?: Array<Partial<EquityGrant>>;
  persons?: Array<Partial<Person>>;
}

function primeStores(opts: PrimeOpts = {}) {
  useEquityGrantsStore.setState({
    equityGrants: (opts.grants ?? []).map((g, i) => ({
      id: g.id ?? i + 1,
      householdId: g.householdId ?? 1,
      ownerPersonId: g.ownerPersonId ?? 1,
      name: g.name ?? `Grant ${i + 1}`,
      companyName: g.companyName ?? 'Acme Corp',
      grantDate: g.grantDate ?? '2024-01-15',
      strikePrice: g.strikePrice ?? 5,
      totalShares: g.totalShares ?? 1000,
      currentFmv: g.currentFmv ?? 50,
      vestingSchedule: g.vestingSchedule ?? [
        { date: '2025-01-15', cumulativePct: 0.25 },
        { date: '2026-01-15', cumulativePct: 0.5 },
        { date: '2027-01-15', cumulativePct: 0.75 },
        { date: '2028-01-15', cumulativePct: 1.0 },
      ],
    })),
    isLoading: false,
    error: null,
  });

  usePersonsStore.setState({
    persons: (opts.persons ?? [basePerson]).map((p, i) => ({
      ...basePerson,
      ...p,
      id: p.id ?? i + 1,
    })),
    isLoading: false,
    error: null,
  });
}

describe('EquityValueCard', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders empty state when no grants exist', () => {
    primeStores();
    render(
      <MemoryRouter>
        <EquityValueCard />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(/Add equity grants to see vested value/i),
    ).toBeInTheDocument();
    // Headline placeholder
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('headline shows total vested value across all grants', () => {
    // Grant A: 1000 × 50 × 0.25 = 12,500
    // Grant B: 2000 × 100 × 0.25 = 50,000
    // Total vested = 62,500
    primeStores({
      grants: [
        {
          name: 'Grant A',
          totalShares: 1000,
          currentFmv: 50,
          vestingSchedule: [
            { date: '2020-01-15', cumulativePct: 0.25 },
            { date: '2099-01-15', cumulativePct: 1.0 },
          ],
        },
        {
          name: 'Grant B',
          totalShares: 2000,
          currentFmv: 100,
          vestingSchedule: [
            { date: '2020-01-15', cumulativePct: 0.25 },
            { date: '2099-01-15', cumulativePct: 1.0 },
          ],
        },
      ],
    });

    render(
      <MemoryRouter>
        <EquityValueCard />
      </MemoryRouter>,
    );

    const headline = screen.getByTestId('equity-value-headline');
    expect(headline).toHaveTextContent('$62,500');
  });

  it('per-person breakdown groups grants by owner', () => {
    // Alice owns 2 grants (10k + 20k vested), Bob owns 1 (5k vested).
    primeStores({
      persons: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
      grants: [
        {
          ownerPersonId: 1,
          totalShares: 1000,
          currentFmv: 10,
          vestingSchedule: [
            { date: '2020-01-15', cumulativePct: 1.0 },
          ],
        },
        {
          ownerPersonId: 1,
          totalShares: 2000,
          currentFmv: 10,
          vestingSchedule: [
            { date: '2020-01-15', cumulativePct: 1.0 },
          ],
        },
        {
          ownerPersonId: 2,
          totalShares: 500,
          currentFmv: 10,
          vestingSchedule: [
            { date: '2020-01-15', cumulativePct: 1.0 },
          ],
        },
      ],
    });

    render(
      <MemoryRouter>
        <EquityValueCard />
      </MemoryRouter>,
    );

    // Alice row: $30,000 vested (10k + 20k). Bob row: $5,000 vested.
    const aliceRow = screen.getByTestId('equity-person-row-1');
    const bobRow = screen.getByTestId('equity-person-row-2');
    expect(within(aliceRow).getByText(/alice/i)).toBeInTheDocument();
    expect(within(aliceRow).getByText(/\$30,000/)).toBeInTheDocument();
    expect(within(bobRow).getByText(/bob/i)).toBeInTheDocument();
    expect(within(bobRow).getByText(/\$5,000/)).toBeInTheDocument();
  });

  it('view-all link points to /equity-grants', () => {
    primeStores({
      grants: [{ name: 'Grant A' }],
    });

    render(
      <MemoryRouter>
        <EquityValueCard />
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: /view all/i });
    expect(link).toHaveAttribute('href', '/equity-grants');
  });

  it('forwards cardId + onHide so the Hide button appears on the card', () => {
    primeStores({
      grants: [{ name: 'Grant A' }],
    });

    render(
      <MemoryRouter>
        <EquityValueCard cardId="equity" onHide={() => {}} />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('button', { name: /hide equity value card/i }),
    ).toBeInTheDocument();
  });
});
