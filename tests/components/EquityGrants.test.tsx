import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { useEquityGrantsStore } from '@/stores/equity-grants-store';
import { usePersonsStore } from '@/stores/persons-store';
import type { EquityGrant, Person } from '@/types/schema';
import EquityGrants from '@/pages/EquityGrants';

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
  // Override load() actions so the page's useEffect calls become no-ops
  // (no real database hits during tests).
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
    load: async () => {},
  });

  usePersonsStore.setState({
    persons: (opts.persons ?? [basePerson]).map((p, i) => ({
      ...basePerson,
      ...p,
      id: p.id ?? i + 1,
    })),
    isLoading: false,
    error: null,
    load: async () => {},
  });
}

describe('EquityGrants page', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders empty state with link to /inputs/equity-grants when no grants exist', () => {
    primeStores();
    render(
      <MemoryRouter>
        <EquityGrants />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('heading', { name: /equity grants/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/no equity grants yet/i)).toBeInTheDocument();
    const addLink = screen.getByRole('link', {
      name: /add your first grant/i,
    });
    expect(addLink).toHaveAttribute('href', '/inputs/equity-grants');
  });

  it('renders one card per grant', () => {
    primeStores({
      grants: [
        { name: 'ISO 2024', companyName: 'Acme' },
        { name: 'RSU 2025', companyName: 'Globex' },
        { name: 'NQSO 2023', companyName: 'Initech' },
      ],
    });

    render(
      <MemoryRouter>
        <EquityGrants />
      </MemoryRouter>,
    );

    expect(screen.getByText('ISO 2024')).toBeInTheDocument();
    expect(screen.getByText('RSU 2025')).toBeInTheDocument();
    expect(screen.getByText('NQSO 2023')).toBeInTheDocument();
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('Globex')).toBeInTheDocument();
    expect(screen.getByText('Initech')).toBeInTheDocument();
  });

  it('summary strip shows total vested value across grants', () => {
    // Two grants both 25% vested at 2026-04-01 (mocked today via vesting
    // schedules already crossed). Grant A: 1000 shares × 50 fmv × 0.25 =
    // 12,500 vested. Grant B: 2000 × 100 × 0.25 = 50,000 vested.
    // Total vested = 62,500.
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
        <EquityGrants />
      </MemoryRouter>,
    );

    // Summary strip surfaces a "Total vested" tile with $62,500.
    const summary = screen.getByTestId('equity-summary');
    expect(within(summary).getByText(/\$62,500/)).toBeInTheDocument();
  });

  it("shows the owner's name on each grant card (looked up via personsStore)", () => {
    // Use grant names that don't share substrings with the person names so the
    // owner-name assertion can match unambiguously.
    primeStores({
      persons: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
      grants: [
        { name: 'ISO 2024', ownerPersonId: 1 },
        { name: 'NQSO 2025', ownerPersonId: 2 },
      ],
    });

    render(
      <MemoryRouter>
        <EquityGrants />
      </MemoryRouter>,
    );

    const aliceCard = screen
      .getByText('ISO 2024')
      .closest('[class*="rounded-xl"]') as HTMLElement;
    const bobCard = screen
      .getByText('NQSO 2025')
      .closest('[class*="rounded-xl"]') as HTMLElement;

    expect(within(aliceCard).getByText(/alice/i)).toBeInTheDocument();
    expect(within(bobCard).getByText(/bob/i)).toBeInTheDocument();
  });

  it('lists upcoming vest dates on each card', () => {
    // Grant whose schedule has future entries (2099 is well past today).
    primeStores({
      grants: [
        {
          name: 'Future Vests',
          vestingSchedule: [
            { date: '2020-01-15', cumulativePct: 0.25 },
            { date: '2099-06-15', cumulativePct: 0.5 },
            { date: '2099-12-15', cumulativePct: 1.0 },
          ],
        },
      ],
    });

    render(
      <MemoryRouter>
        <EquityGrants />
      </MemoryRouter>,
    );

    expect(screen.getByText(/2099-06-15/)).toBeInTheDocument();
    expect(screen.getByText(/2099-12-15/)).toBeInTheDocument();
  });

  it('grant past final vest date shows 100% vested (no upcoming dates)', () => {
    // Vesting schedule entirely in the past — should be 100% vested.
    primeStores({
      grants: [
        {
          name: 'Fully Vested',
          totalShares: 100,
          currentFmv: 10,
          vestingSchedule: [
            { date: '2020-01-15', cumulativePct: 0.5 },
            { date: '2021-01-15', cumulativePct: 1.0 },
          ],
        },
      ],
    });

    render(
      <MemoryRouter>
        <EquityGrants />
      </MemoryRouter>,
    );

    // Vested value = 100 × 10 = $1,000; unvested = $0.
    const card = screen
      .getByText('Fully Vested')
      .closest('[class*="rounded-xl"]') as HTMLElement;
    expect(within(card).getByText(/\$1,000/)).toBeInTheDocument();
    // No "Upcoming vest" entries because none are after today.
    expect(within(card).queryByText(/2099-/)).not.toBeInTheDocument();
  });

  it('"Manage grants" link points to /inputs/equity-grants when grants exist', () => {
    primeStores({
      grants: [{ name: 'Some Grant' }],
    });

    render(
      <MemoryRouter>
        <EquityGrants />
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: /manage grants/i });
    expect(link).toHaveAttribute('href', '/inputs/equity-grants');
  });

  it('renders a "+ Add grant" button in the page header when grants exist', () => {
    primeStores({ grants: [{ name: 'Some Grant' }] });
    render(
      <MemoryRouter>
        <EquityGrants />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: /add grant/i })).toBeInTheDocument();
  });

  it('clicking "+ Add grant" opens AddEquityGrantDialog', async () => {
    primeStores({ grants: [{ name: 'Some Grant' }] });
    render(
      <MemoryRouter>
        <EquityGrants />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: /add grant/i }));
    expect(await screen.findByText(/^add equity grant$/i)).toBeInTheDocument();
  });

  it('Export CSV button downloads the equity grants table with the owner name resolved', async () => {
    primeStores({
      persons: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
      grants: [
        {
          name: 'ISO 2024',
          companyName: 'Acme',
          ownerPersonId: 2,
          grantDate: '2024-01-15',
          strikePrice: 5,
          totalShares: 1000,
          currentFmv: 50,
        },
      ],
    });

    let capturedCsv = '';
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      void (b as Blob).text().then((t) => {
        capturedCsv = t;
      });
      return 'blob:mock';
    });
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    render(
      <MemoryRouter>
        <EquityGrants />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: /export csv/i }));
    await Promise.resolve();

    expect(capturedCsv.split('\n')[0]).toBe(
      'name,company,owner,grant date,strike price,total shares,current FMV',
    );
    expect(capturedCsv.split('\n')[1]).toBe('ISO 2024,Acme,Bob,2024-01-15,5,1000,50');

    createSpy.mockRestore();
    revokeSpy.mockRestore();
  });

  it('shows the loading skeleton, not "No equity grants yet", while loading (W10 M18)', () => {
    useEquityGrantsStore.setState({ equityGrants: [], isLoading: true, error: null, load: async () => {} } as any);
    usePersonsStore.setState({ persons: [], isLoading: false, error: null, load: async () => {} } as any);
    render(<MemoryRouter><EquityGrants /></MemoryRouter>);
    expect(screen.getByRole('status', { name: /loading page/i })).toBeInTheDocument();
    expect(screen.queryByText('No equity grants yet')).not.toBeInTheDocument();
  });
});
