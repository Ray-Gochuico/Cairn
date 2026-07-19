import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useEquityGrantsStore } from '@/stores/equity-grants-store';
import { usePersonsStore } from '@/stores/persons-store';
import type { EquityGrant, Person } from '@/types/schema';
import { EquityValueCard } from '@/pages/calculators/EquityValueCard';

// Pin "today" to a stable date so vest-date comparisons in computeEquityValue
// are fully deterministic. Mirrors the pattern used in CoastFiCard.test.tsx.
// With this anchor:
//   - Dates <= 2026-05-14 are in the past → vested
//   - Dates > 2026-05-14 (e.g. 2027-01-15) are upcoming → unvested
// Tests can use realistic near-term vest dates instead of far-future 2099 dates.
const PINNED_DATE = new Date('2026-05-14T12:00:00Z');

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
      updatedAt: g.updatedAt,
      grantType: g.grantType ?? 'RSU',
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
    // Pin "today" to a stable date so vest-date logic in computeEquityValue is
    // deterministic across runs. Mirrors the CoastFiCard.test.tsx pattern.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(PINNED_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders empty state when no grants exist', () => {
    primeStores();
    render(
      <MemoryRouter>
        <EquityValueCard />
      </MemoryRouter>,
    );
    // "Add equity grants" is now a link (Wave 15 T10) — pin the link phrase
    // and the remaining tail separately since the link boundary splits the
    // sentence.
    expect(
      screen.getByRole('link', { name: /add equity grants/i }),
    ).toHaveAttribute('href', '/equity-grants');
    expect(screen.getByText(/to see vested value/i)).toBeInTheDocument();
    // Headline placeholder
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('empty-state CTA links to the destination it names (Wave 15 T10)', () => {
    primeStores();
    render(
      <MemoryRouter>
        <EquityValueCard />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('link', { name: /add equity grants/i }),
    ).toHaveAttribute('href', '/equity-grants');
  });

  it('headline shows total vested value across all grants', () => {
    // Pinned to 2026-05-14. Past vest on 2020-01-15 (25%) → vested; future vest
    // on 2027-01-15 (100%) → not yet counted. So only 25% of each grant is vested.
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
            { date: '2027-01-15', cumulativePct: 1.0 },
          ],
        },
        {
          name: 'Grant B',
          totalShares: 2000,
          currentFmv: 100,
          vestingSchedule: [
            { date: '2020-01-15', cumulativePct: 0.25 },
            { date: '2027-01-15', cumulativePct: 1.0 },
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

  it('numeric columns are right-aligned (Wave 15 T9, Allocator precedent)', () => {
    primeStores({
      persons: [{ id: 1, name: 'Alice' }],
      grants: [
        {
          ownerPersonId: 1,
          totalShares: 1000,
          currentFmv: 10,
          vestingSchedule: [{ date: '2020-01-15', cumulativePct: 1.0 }],
        },
      ],
    });

    render(
      <MemoryRouter>
        <EquityValueCard />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('columnheader', { name: /^grants$/i }).className,
    ).toContain('text-right');
    expect(
      screen.getByRole('columnheader', { name: /vested value/i }).className,
    ).toContain('text-right');
    // Identity column stays left-aligned.
    expect(
      screen.getByRole('columnheader', { name: /^owner$/i }).className,
    ).not.toContain('text-right');
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

  it('forwards cardId so the card shell mounts with its stable testid (Wave 17)', () => {
    render(
      <MemoryRouter>
        <EquityValueCard cardId="equity" />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('calc-card-equity')).toBeInTheDocument();
  });

  it('renders the total vested value through ResultRow with a stable testId', () => {
    primeStores({
      grants: [
        {
          name: 'Grant A',
          totalShares: 1000,
          currentFmv: 50,
          // Pinned to 2026-05-14: past vest (25% at 2020-01-15), upcoming (100% at 2027-01-15)
          vestingSchedule: [
            { date: '2020-01-15', cumulativePct: 0.25 },
            { date: '2027-01-15', cumulativePct: 1.0 },
          ],
        },
      ],
    });
    render(
      <MemoryRouter>
        <EquityValueCard />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('equity-total-vested').textContent).toMatch(/\$[\d,]+/);
  });

  it('renders unvested value, upcoming vest dates, and grant-type badge (ISO)', () => {
    // Pinned to 2026-05-14.
    // Grant: 1000 shares at $50 FMV.
    // Past vest (2020-01-15 @ 25%) → vestedValue = 250 × 50 = $12,500
    // Upcoming vest (2027-01-15 @ 100%) → unvestedValue = 750 × 50 = $37,500
    primeStores({
      grants: [
        {
          name: 'ISO Grant',
          grantType: 'ISO',
          totalShares: 1000,
          currentFmv: 50,
          strikePrice: 10,
          vestingSchedule: [
            { date: '2020-01-15', cumulativePct: 0.25 },
            { date: '2027-01-15', cumulativePct: 1.0 },
          ],
        },
      ],
    });
    render(
      <MemoryRouter>
        <EquityValueCard />
      </MemoryRouter>,
    );

    // T21 exact pin: ISO unvested value is the INTRINSIC spread —
    // 750 unvested × ($50 FMV − $10 strike) = $30,000 (equity-value.ts
    // perShare; the older $37,500 comment assumed FMV × shares and was stale).
    expect(screen.getByTestId('equity-total-unvested').textContent).toBe('$30,000');

    // upcoming vests block must be present and contain the realistic near-term date
    const upcomingBlock = screen.getByTestId('equity-upcoming-vests');
    expect(upcomingBlock).toBeInTheDocument();
    // Humanized vest date (Wave 11 T4), not raw ISO.
    expect(upcomingBlock.textContent).toMatch(/Jan 15, 2027/);
    expect(upcomingBlock.textContent).not.toMatch(/2027-01-15/);

    // grant-type badge must show 'ISO'
    expect(screen.getByText('ISO')).toBeInTheDocument();
  });

  it('shows RSU grant-type badge (plain, no tooltip) for RSU grants', () => {
    primeStores({
      grants: [
        {
          name: 'RSU Grant',
          grantType: 'RSU',
          totalShares: 500,
          currentFmv: 100,
          // Pinned to 2026-05-14: past vest (50% at 2020-01-15), upcoming (100% at 2027-01-15)
          vestingSchedule: [
            { date: '2020-01-15', cumulativePct: 0.5 },
            { date: '2027-01-15', cumulativePct: 1.0 },
          ],
        },
      ],
    });
    render(
      <MemoryRouter>
        <EquityValueCard />
      </MemoryRouter>,
    );

    // Badge text 'RSU' in the person row
    const personRow = screen.getByTestId('equity-person-row-1');
    expect(within(personRow).getByText('RSU')).toBeInTheDocument();

    // T21 exact pin: unvested = 250 shares × $100 FMV = $25,000.
    expect(screen.getByTestId('equity-total-unvested').textContent).toBe('$25,000');
  });

  it('does not render equity-upcoming-vests block when all vests are in the past', () => {
    primeStores({
      grants: [
        {
          name: 'Fully Vested',
          grantType: 'RSU',
          totalShares: 200,
          currentFmv: 25,
          vestingSchedule: [
            { date: '2019-01-15', cumulativePct: 0.5 },
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
    // No upcoming vests → block should not render
    expect(screen.queryByTestId('equity-upcoming-vests')).not.toBeInTheDocument();
  });

  it('renders the forward vest chart (D10) when vests lie in the next 24 months', () => {
    // Pinned 2026-05-14: three of the four vests are still ahead within 24mo.
    primeStores({
      grants: [
        {
          name: 'Multi-vest Grant',
          grantType: 'RSU',
          totalShares: 1000,
          currentFmv: 50,
          vestingSchedule: [
            { date: '2025-01-15', cumulativePct: 0.25 },
            { date: '2026-01-15', cumulativePct: 0.5 },
            { date: '2027-01-15', cumulativePct: 0.75 },
            { date: '2028-01-15', cumulativePct: 1.0 },
          ],
        },
      ],
    });
    render(
      <MemoryRouter>
        <EquityValueCard />
      </MemoryRouter>,
    );
    // The InlineChart label renders even though recharts draws 0×0 in jsdom.
    expect(screen.getByText('Vesting ahead (24 months)')).toBeInTheDocument();
    // The all-time cumulative chart is gone (D10 — planning charts look forward).
    expect(screen.queryByText('Cumulative vesting')).not.toBeInTheDocument();
  });

  it('no forward vests → the quiet fully-vested line replaces the chart (D10)', () => {
    primeStores({
      grants: [
        {
          name: 'Single Vest',
          grantType: 'RSU',
          totalShares: 500,
          currentFmv: 20,
          vestingSchedule: [
            { date: '2025-06-01', cumulativePct: 1.0 }, // past at the pinned date
          ],
        },
      ],
    });
    render(
      <MemoryRouter>
        <EquityValueCard />
      </MemoryRouter>,
    );
    expect(screen.queryByText('Vesting ahead (24 months)')).not.toBeInTheDocument();
    expect(screen.getByText('All grants fully vested.')).toBeInTheDocument();
  });

  it('shows est. ordinary income row for an NSO grant with unvested shares', () => {
    // Pinned to 2026-05-14. NSO: strike=10, fmv=50, 25% vested in past, 75% unvested.
    // ordinary income = 750 shares × (50−10) = $30,000
    primeStores({
      grants: [
        {
          name: 'NSO Grant',
          grantType: 'NSO',
          totalShares: 1000,
          currentFmv: 50,
          strikePrice: 10,
          vestingSchedule: [
            { date: '2020-01-15', cumulativePct: 0.25 },
            { date: '2027-01-15', cumulativePct: 1.0 },
          ],
        },
      ],
    });
    render(
      <MemoryRouter>
        <EquityValueCard />
      </MemoryRouter>,
    );
    // T21 exact pin: NSO spread = 750 unvested × ($50 − $10 strike) = $30,000.
    expect(screen.getByTestId('equity-ordinary-income').textContent).toBe('$30,000');
  });

  it('shows est. ordinary income row for an RSU grant with unvested shares', () => {
    // Pinned to 2026-05-14. RSU: strike=0, fmv=50, 25% vested in past, 75% unvested.
    // ordinary income = 750 × 50 = $37,500
    primeStores({
      grants: [
        {
          name: 'RSU Grant',
          grantType: 'RSU',
          totalShares: 1000,
          currentFmv: 50,
          strikePrice: 0,
          vestingSchedule: [
            { date: '2020-01-15', cumulativePct: 0.25 },
            { date: '2027-01-15', cumulativePct: 1.0 },
          ],
        },
      ],
    });
    render(
      <MemoryRouter>
        <EquityValueCard />
      </MemoryRouter>,
    );
    // T21 exact pin: RSU income = 750 unvested × $50 FMV = $37,500.
    expect(screen.getByTestId('equity-ordinary-income').textContent).toBe('$37,500');
  });

  it('shows AMT note when an ISO grant is present', () => {
    primeStores({
      grants: [
        {
          name: 'ISO Grant',
          grantType: 'ISO',
          totalShares: 1000,
          currentFmv: 50,
          strikePrice: 10,
          vestingSchedule: [
            { date: '2020-01-15', cumulativePct: 0.25 },
            { date: '2027-01-15', cumulativePct: 1.0 },
          ],
        },
      ],
    });
    render(
      <MemoryRouter>
        <EquityValueCard />
      </MemoryRouter>,
    );
    // The AMT note must be in the document (Wave 18: it lives inside the
    // NotModeledDisclosure; the TermTooltip splits the text nodes).
    expect(screen.getAllByText(/AMT/).length).toBeGreaterThan(0);
    expect(screen.getByText(/ISO grants may trigger/i)).toBeInTheDocument();
  });

  it('does NOT show AMT note when only RSU grants are present', () => {
    primeStores({
      grants: [
        {
          name: 'RSU Only',
          grantType: 'RSU',
          totalShares: 500,
          currentFmv: 100,
          strikePrice: 0,
          vestingSchedule: [
            { date: '2020-01-15', cumulativePct: 0.25 },
            { date: '2027-01-15', cumulativePct: 1.0 },
          ],
        },
      ],
    });
    render(
      <MemoryRouter>
        <EquityValueCard />
      </MemoryRouter>,
    );
    // The AMT preference note must NOT be present (the RSU badge is plain text, no AMT note)
    expect(screen.queryByText(/ISO grants may trigger/i)).not.toBeInTheDocument();
  });
});

describe('EquityValueCard waymark meaning (Wave 17)', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders the waymark meaning line from already-rendered values (Wave 18: dual reading)', () => {
    primeStores({ grants: [{}, {}] });
    render(<MemoryRouter><EquityValueCard cardId="equity" /></MemoryRouter>);
    expect(screen.getByTestId('equity-meaning')).toHaveTextContent(
      /vested today · .* vesting in the next 12 months/i,
    );
  });

  it('empty state: headline —, cairn glyph, CTA in the meaning slot', () => {
    render(<MemoryRouter><EquityValueCard cardId="equity" /></MemoryRouter>);
    expect(screen.getByTestId('equity-headline')).toHaveTextContent('—');
    expect(document.querySelector('[data-testid="cairn-glyph"]')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /add equity grants/i })).toHaveAttribute(
      'href',
      '/equity-grants',
    );
  });
});

describe('EquityValueCard — real calculator (Wave 18 C11)', () => {
  beforeEach(() => {
    resetStores();
    sessionStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(PINNED_DATE);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const singleCompanyGrant = {
    name: 'RSU Grant',
    grantType: 'RSU' as const,
    companyName: 'Acme Corp',
    totalShares: 1000,
    currentFmv: 50,
    strikePrice: 0,
    vestingSchedule: [
      { date: '2020-01-15', cumulativePct: 0.25 },
      { date: '2027-01-15', cumulativePct: 1.0 },
    ],
  };

  it('FMV what-if reprices vested/unvested/income live; Reset restores (D8)', async () => {
    primeStores({ grants: [singleCompanyGrant] });
    render(<MemoryRouter><EquityValueCard /></MemoryRouter>);

    // Prefilled from the stored FMV.
    const fmv = screen.getByLabelText(/fmv per share/i) as HTMLInputElement;
    expect(Number(fmv.value)).toBe(50);
    expect(screen.getByTestId('equity-total-vested').textContent).toBe('$12,500');

    fireEvent.change(fmv, { target: { value: '80' } });
    // 250 vested × $80 = $20,000; unvested 750 × 80 = $60,000; next-12 income
    // = 750 × 80 = $60,000 (the 2027-01-15 vest is inside the window).
    expect(screen.getByTestId('equity-total-vested').textContent).toBe('$20,000');
    expect(screen.getByTestId('equity-total-unvested').textContent).toBe('$60,000');
    expect(screen.getByTestId('equity-ordinary-income').textContent).toBe('$60,000');

    fireEvent.click(screen.getByRole('button', { name: /reset to my data/i }));
    expect(screen.getByTestId('equity-total-vested').textContent).toBe('$12,500');
  });

  it('D8: multi-company households see the quiet note instead of the FMV field', () => {
    primeStores({
      grants: [
        singleCompanyGrant,
        { ...singleCompanyGrant, name: 'Other', companyName: 'Globex' },
      ],
    });
    render(<MemoryRouter><EquityValueCard /></MemoryRouter>);
    expect(screen.queryByLabelText(/fmv per share/i)).toBeNull();
    expect(
      screen.getByText(/Grants span multiple companies — edit each grant's FMV in Inputs\./),
    ).toBeInTheDocument();
  });

  it('D9: the FMV caption carries the stored updatedAt date when present', () => {
    primeStores({
      grants: [{ ...singleCompanyGrant, updatedAt: '2026-04-01 10:00:00' }],
    });
    render(<MemoryRouter><EquityValueCard /></MemoryRouter>);
    expect(screen.getByText(/prefilled from your stored FMV/i)).toBeInTheDocument();
    expect(screen.getByText(/updated Apr 1, 2026/i)).toBeInTheDocument();
  });

  it('D9: no date parenthetical when updatedAt is absent', () => {
    primeStores({ grants: [singleCompanyGrant] });
    render(<MemoryRouter><EquityValueCard /></MemoryRouter>);
    expect(screen.getByText(/prefilled from your stored FMV/i)).toBeInTheDocument();
    expect(screen.queryByText(/updated /i)).toBeNull();
  });

  it('planning-figure swap: next-12-months emphasis row replaces the vests-today row', () => {
    primeStores({ grants: [singleCompanyGrant] });
    render(<MemoryRouter><EquityValueCard /></MemoryRouter>);
    // 750 shares vest 2027-01-15 (inside 12mo of 2026-05-14) × $50 = $37,500.
    expect(screen.getByTestId('equity-next-12mo').textContent).toBe('$37,500');
    expect(screen.getByText('Vesting in the next 12 months')).toBeInTheDocument();
    expect(screen.getByText('Est. ordinary income from those vests')).toBeInTheDocument();
    // The caveat survives as this row's caption.
    expect(
      screen.getByText('Estimated ordinary income at vest — not withheld tax.'),
    ).toBeInTheDocument();
    // The old vests-today framing is gone.
    expect(screen.queryByText(/if unvested vests today/i)).toBeNull();
  });

  it('upcoming vests get dollars: date · value pairs', () => {
    primeStores({ grants: [singleCompanyGrant] });
    render(<MemoryRouter><EquityValueCard /></MemoryRouter>);
    const block = screen.getByTestId('equity-upcoming-vests');
    expect(block.textContent).toMatch(/Next vests: Jan 15, 2027 · \$37,500/);
  });

  it('ONE NotModeledDisclosure absorbs the scattered fine print (withholding caveat first)', () => {
    primeStores({ grants: [singleCompanyGrant] });
    render(<MemoryRouter><EquityValueCard /></MemoryRouter>);
    const details = document.querySelector('details')!;
    expect(details).toHaveTextContent('What this calculator does NOT model');
    expect(details).toHaveTextContent(
      /Vest-day ordinary income is an estimate of taxable income, not the tax your employer withholds/,
    );
    expect(details).toHaveTextContent(
      /FMV is your stored estimate, not a live market price/,
    );
  });
});
