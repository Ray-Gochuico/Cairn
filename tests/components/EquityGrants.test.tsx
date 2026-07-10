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

  it('empty state offers an in-place "Add your first grant" that opens the drawer (W14)', async () => {
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
    // W14: the CTA opens the create drawer in place — no /inputs deflection.
    expect(screen.queryByRole('link', { name: /add your first grant/i })).toBeNull();
    expect(screen.queryByText(/in inputs/i)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /add your first grant/i }));
    expect(
      await screen.findByRole('dialog', { name: /add equity grant/i }),
    ).toBeInTheDocument();
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
      .closest('[class*="rounded-lg"]') as HTMLElement;
    const bobCard = screen
      .getByText('NQSO 2025')
      .closest('[class*="rounded-lg"]') as HTMLElement;

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

    // Humanized vest dates (Wave 11 T4), not raw ISO.
    expect(screen.getByText(/Jun 15, 2099/)).toBeInTheDocument();
    expect(screen.getByText(/Dec 15, 2099/)).toBeInTheDocument();
    expect(screen.queryByText(/2099-06-15/)).not.toBeInTheDocument();
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
      .closest('[class*="rounded-lg"]') as HTMLElement;
    expect(within(card).getByText(/\$1,000/)).toBeInTheDocument();
    // No "Upcoming vest" entries because none are after today.
    expect(within(card).queryByText(/2099-/)).not.toBeInTheDocument();
  });

  it('no "Manage grants" deflection remains; "Add grant" opens the create drawer (W14)', async () => {
    primeStores({ grants: [{ name: 'Some Grant' }] });
    render(
      <MemoryRouter>
        <EquityGrants />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link', { name: /manage grants/i })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /^add grant$/i }));
    expect(
      await screen.findByRole('dialog', { name: /add equity grant/i }),
    ).toBeInTheDocument();
  });

  it('drawer Cancel closes without calling create (W14; ported from AddEquityGrantDialog)', async () => {
    const createSpy = vi.fn(async () => 1);
    primeStores({ grants: [{ name: 'Some Grant' }] });
    useEquityGrantsStore.setState({ create: createSpy } as never);
    render(
      <MemoryRouter>
        <EquityGrants />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: /^add grant$/i }));
    const dialog = await screen.findByRole('dialog', { name: /add equity grant/i });
    // The calculator section rides along with the shared form (dialog-test port).
    expect(
      within(dialog).getByText(/estimate it from company valuation/i),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: /^cancel$/i }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('per-grant "Edit grant" opens a prefilled drawer; saving calls update (W14)', async () => {
    const updateSpy = vi.fn(async () => {});
    primeStores({ grants: [{ id: 9, name: 'ISO 2024' }] });
    useEquityGrantsStore.setState({ update: updateSpy } as never);
    render(
      <MemoryRouter>
        <EquityGrants />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: /edit grant iso 2024/i }));
    const dialog = await screen.findByRole('dialog', { name: /edit equity grant/i });
    expect(within(dialog).getByLabelText(/^name$/i)).toHaveValue('ISO 2024');
    await userEvent.click(within(dialog).getByRole('button', { name: /^save$/i }));
    await vi.waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(updateSpy).toHaveBeenCalledWith(9, expect.objectContaining({ name: 'ISO 2024' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('drawer delete confirms with the tab\'s exact copy (W14)', async () => {
    primeStores({ grants: [{ id: 9, name: 'ISO 2024' }] });
    render(
      <MemoryRouter>
        <EquityGrants />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: /edit grant iso 2024/i }));
    const dialog = await screen.findByRole('dialog', { name: /edit equity grant/i });
    await userEvent.click(within(dialog).getByRole('button', { name: /delete grant/i }));
    expect(
      await screen.findByText(/permanently removes this equity grant and its vesting schedule/i),
    ).toBeInTheDocument();
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

describe('person-view filter (round-3 T21)', () => {
  beforeEach(() => {
    resetStores();
  });

  function primeTwoOwners() {
    primeStores({
      persons: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
      grants: [
        { id: 1, ownerPersonId: 1, name: 'Alice Grant' },
        { id: 2, ownerPersonId: 2, name: 'Bob Grant' },
      ],
    });
  }

  it("?view=p2 shows only person 2's grant", () => {
    primeTwoOwners();
    render(
      <MemoryRouter initialEntries={['/equity-grants?view=p2']}>
        <EquityGrants />
      </MemoryRouter>,
    );
    expect(screen.getByText('Bob Grant')).toBeInTheDocument();
    expect(screen.queryByText('Alice Grant')).not.toBeInTheDocument();
  });

  it('?view=joint shows no grant cards (grants are individual)', () => {
    primeTwoOwners();
    render(
      <MemoryRouter initialEntries={['/equity-grants?view=joint']}>
        <EquityGrants />
      </MemoryRouter>,
    );
    // filterGrantsByView returns [] for joint — no grant card renders and the
    // summary strip totals $0 (grants have no joint-ownership concept).
    expect(screen.queryByText('Alice Grant')).not.toBeInTheDocument();
    expect(screen.queryByText('Bob Grant')).not.toBeInTheDocument();
    expect(screen.getByTestId('equity-summary')).toHaveTextContent('$0');
  });
});

describe('EquityGrants page — drawer create submits (W14 page-level create coverage)', () => {
  beforeEach(() => {
    resetStores();
  });

  it('filling the create drawer (with template schedule) calls create and closes', async () => {
    const create = vi.fn(async () => 1);
    primeStores({ grants: [{ name: 'Existing Grant' }] });
    useEquityGrantsStore.setState({ create } as never);
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <EquityGrants />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: /^add grant$/i }));
    const dialog = await screen.findByRole('dialog', { name: /add equity grant/i });
    await user.type(within(dialog).getByLabelText(/^name$/i), '2024 RSU grant');
    await user.type(within(dialog).getByLabelText(/^company$/i), 'Acme Corp');
    await user.click(within(dialog).getByRole('radio', { name: /alice/i }));
    const picker = within(dialog).getByTestId('grant-date-picker');
    await user.selectOptions(within(picker).getByLabelText(/year$/i), '2024');
    await user.selectOptions(within(picker).getByLabelText(/month$/i), '01');
    await user.selectOptions(within(picker).getByLabelText(/day$/i), '15');
    await user.type(within(dialog).getByLabelText(/total shares/i), '4800');
    await user.type(within(dialog).getByLabelText(/current fmv/i), '120');
    await user.selectOptions(
      within(dialog).getByLabelText(/vesting template/i),
      'FOUR_YR_MONTHLY_ONE_YR_CLIFF',
    );
    await user.click(within(dialog).getByRole('button', { name: /^save$/i }));
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '2024 RSU grant',
        companyName: 'Acme Corp',
        grantDate: '2024-01-15',
        totalShares: 4800,
        currentFmv: 120,
      }),
    );
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  }, 15000);
});
