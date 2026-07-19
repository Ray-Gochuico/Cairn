import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { FilingStatus } from '@/types/enums';
import { Retirement401kWithdrawalCard } from '@/pages/calculators/Retirement401kWithdrawalCard';

const federalSingleBrackets = [
  { min: 0,      max: 11_600,  rate: 0.10 },
  { min: 11_600, max: 47_150,  rate: 0.12 },
  { min: 47_150, max: 100_525, rate: 0.22 },
  { min: 100_525,max: 191_950, rate: 0.24 },
  { min: 191_950,max: 243_725, rate: 0.32 },
  { min: 243_725,max: null,    rate: 0.35 },
];

const caFlatBrackets = [{ min: 0, max: null, rate: 0.05 }];

function resetStores() {
  useHouseholdStore.setState({ household: null, isLoading: false, error: null });
  usePersonsStore.setState({ persons: [], isLoading: false, error: null });
  useTaxRulesStore.setState({ year: null, items: [], isLoading: false, error: null });
}

function primeStores() {
  useHouseholdStore.setState({
    household: {
      filingStatus: FilingStatus.SINGLE,
      state: 'CA',
      city: null,
      monthlyExpenseBaseline: 5000,
      withdrawalRate: 0.04,
      inflationAssumption: 0.03,
      growthScenarios: [],
    },
    isLoading: false,
    error: null,
  });

  usePersonsStore.setState({
    persons: [
      {
        id: 1,
        householdId: 1,
        name: 'Alice',
        dateOfBirth: '1965-04-01',
        targetRetirementAge: 65,
        annualSalaryPretax: 120_000,
        expectedCommission: 0,
        expectedCommissionFrequency: 'MONTHLY',
        pretax401kPct: 0,
        healthInsuranceMonthlyPremium: 0,
        dependentCareFsaMonthly: 0,
        hsaMonthlyContribution: 0,
        hsaEligible: false,
      },
    ],
    isLoading: false,
    error: null,
  });

  useTaxRulesStore.setState({
    year: 2026,
    items: [
      {
        id: 1,
        year: 2026,
        jurisdictionType: 'FEDERAL',
        jurisdictionCode: 'US',
        filingStatus: FilingStatus.SINGLE,
        brackets: federalSingleBrackets,
        standardDeduction: 14_600,
      },
      {
        id: 2,
        year: 2026,
        jurisdictionType: 'STATE',
        jurisdictionCode: 'CA',
        filingStatus: FilingStatus.SINGLE,
        brackets: caFlatBrackets,
        standardDeduction: 0,
      },
    ],
    isLoading: false,
    error: null,
  });
}

describe('Retirement401kWithdrawalCard', () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetStores();
  });

  it("pre-fills the W-2 income default from the selected earner's salary (Wave 18 A5)", () => {
    primeStores();
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );
    const w2 = screen.getByLabelText(/annual w-2 income/i) as HTMLInputElement;
    expect(Number(w2.value)).toBe(120_000);
  });

  it('D7 (Wave 18): a bar salary override moves the W-2 prefill; store untouched', async () => {
    const { __resetScenarioAssumptionsForTests } = await import(
      '@/lib/calculators/use-scenario-assumptions'
    );
    primeStores(); // Alice $120k
    sessionStorage.setItem('calc-scenario:salaries', JSON.stringify({ 1: 80000 }));
    __resetScenarioAssumptionsForTests();
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );
    const w2 = screen.getByLabelText(/annual w-2 income/i) as HTMLInputElement;
    expect(Number(w2.value)).toBe(80000);
    expect(usePersonsStore.getState().persons[0].annualSalaryPretax).toBe(120_000);
    // Clean the module-level salary cache for later tests.
    sessionStorage.removeItem('calc-scenario:salaries');
    __resetScenarioAssumptionsForTests();
  });

  it('single-person household renders no earner picker (Wave 18 A5)', () => {
    primeStores();
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('group', { name: /whose withdrawal/i })).not.toBeInTheDocument();
  });

  it('two-person household: switching earner re-derives the W-2 and age prefills (Wave 18 A5)', async () => {
    const user = userEvent.setup();
    primeStores();
    const alice = usePersonsStore.getState().persons[0];
    usePersonsStore.setState({
      persons: [
        alice,
        { ...alice, id: 2, name: 'Bob', annualSalaryPretax: 60_000, dateOfBirth: '1980-06-15' },
      ],
      isLoading: false,
      error: null,
    });
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );
    // Default = first person (Alice, $120k, born 1965).
    expect(Number((screen.getByLabelText(/annual w-2 income/i) as HTMLInputElement).value)).toBe(
      120_000,
    );
    const aliceAge = Number(
      (screen.getByLabelText(/age at withdrawal/i) as HTMLInputElement).value,
    );
    expect(aliceAge).toBeGreaterThan(55);

    const group = screen.getByRole('group', { name: /whose withdrawal/i });
    await user.click(within(group).getByRole('button', { name: 'Bob' }));

    // A withdrawal belongs to ONE account owner: W-2 = Bob's salary alone
    // (never the household sum), age from Bob's DOB.
    expect(Number((screen.getByLabelText(/annual w-2 income/i) as HTMLInputElement).value)).toBe(
      60_000,
    );
    const bobAge = Number(
      (screen.getByLabelText(/age at withdrawal/i) as HTMLInputElement).value,
    );
    expect(bobAge).toBeLessThan(aliceAge - 10);
  });

  it('pre-fills the age default from persons[0].dateOfBirth', () => {
    primeStores();
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );
    const ageInput = screen.getByLabelText(/age at withdrawal/i) as HTMLInputElement;
    expect(Number(ageInput.value)).toBeGreaterThan(18);
  });

  it('default (no withdrawal entered) shows "—" + a prompt, not a $0 breakdown', () => {
    primeStores();
    render(<MemoryRouter><Retirement401kWithdrawalCard /></MemoryRouter>);
    expect(screen.getByTestId('401k-withdrawal-net').textContent).toBe('—');
    expect(screen.getByText(/Enter a withdrawal amount/i)).toBeInTheDocument();
    // Controls stay visible (supplemental-card idiom).
    expect(screen.getByLabelText(/withdrawal amount/i)).toBeInTheDocument();
    // No breakdown rows rendered.
    expect(screen.queryByText(/Federal tax on withdrawal/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('summary-net-to-you')).not.toBeInTheDocument();
  });

  it('Roth radio is enabled (no longer "coming soon")', () => {
    primeStores();
    useTaxRulesStore.setState((s) => ({ ...s, year: 2026 }));
    render(<MemoryRouter><Retirement401kWithdrawalCard /></MemoryRouter>);
    const roth = screen.getByRole('radio', { name: /^Roth 401k$/i });
    expect(roth).not.toBeDisabled();
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
  });

  it('selecting Roth zeroes EVERY tax line + penalty + effective rate (all-sites $0 guard)', () => {
    primeStores();
    render(<MemoryRouter><Retirement401kWithdrawalCard /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Withdrawal amount/i), { target: { value: '40000' } });
    // Non-zero W-2 + cap gains + other-investment income so the Traditional
    // path would produce non-zero federal/state/city/NIIT — proving Roth zeroes
    // them rather than them happening to be 0. Young age so Traditional would
    // also levy the 10% penalty (proving Roth waives it).
    fireEvent.change(screen.getByLabelText(/Annual W-2 income/i), { target: { value: '200000' } });
    fireEvent.change(screen.getByLabelText(/Capital gains for the year/i), { target: { value: '20000' } });
    fireEvent.change(screen.getByLabelText(/Other investment income/i), { target: { value: '15000' } });
    fireEvent.change(screen.getByLabelText(/Age at withdrawal/i), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('radio', { name: /^Roth 401k$/i }));

    // Headline: net == full withdrawal (no tax taken).
    expect(screen.getByTestId('401k-withdrawal-net').textContent).toBe('$40,000');

    // EVERY jurisdiction/tax line the card renders reads $0 — a missed
    // breakdown.→view. swap (M2) would leave one of these non-zero under the
    // $0 headline and fail HERE. Assert each row's value cell.
    const expectZeroRow = (labelRe: RegExp) => {
      const row = screen.getByText(labelRe).closest('div')!;
      expect(within(row).getByText('$0')).toBeInTheDocument();
    };
    expectZeroRow(/Federal tax on withdrawal/i);
    expectZeroRow(/State tax on withdrawal/i);
    expectZeroRow(/City tax on withdrawal/i);
    // NIIT delta + penalty have stable test ids — prefer them over label-closest.
    expect(within(screen.getByTestId('401k-withdrawal-niit-row')).getByText('$0')).toBeInTheDocument();
    expect(within(screen.getByTestId('401k-penalty-row')).getByText('$0')).toBeInTheDocument();
    // Summary tile: total taxes $0. The label + value are SIBLING divs inside
    // the tile, so scope to the tile via its data-testid attribute (the
    // label's own .closest('div') is just the label div — value not inside it).
    const taxTile = screen.getByTestId('summary-taxes-paid');
    expect(within(taxTile).getByText('$0')).toBeInTheDocument();
    // Effective rate 0% — label + value share one flex row, so .closest('div')
    // of the label IS that row and contains the value.
    expect(within(screen.getByText(/Effective rate on this withdrawal/i).closest('div')!).getByText(/^0(\.0)?%$/)).toBeInTheDocument();

    // UX F-3: the penalty parenthetical is suppressed under Roth (no "10%"/"59½").
    expect(within(screen.getByTestId('401k-penalty-row')).queryByText(/10%|59½/)).not.toBeInTheDocument();
  });

  it('computes the 10% early-withdrawal penalty when the user is under 59.5', async () => {
    primeStores();
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );

    const ageInput = screen.getByLabelText(/age at withdrawal/i);
    fireEvent.change(ageInput, { target: { value: '45' } });

    const withdrawalInput = screen.getByLabelText(/withdrawal amount/i);
    fireEvent.change(withdrawalInput, { target: { value: '50000' } });

    // R7a: "Early-withdrawal penalty" is now wrapped in a TermTooltip so
    // findByText returns the inner span. Walk up to the flex row via closest.
    const penaltyLabel = await screen.findByText(/early-withdrawal penalty/i);
    const row = penaltyLabel.closest('.flex.justify-between') as HTMLElement;
    expect(row).not.toBeNull();
    expect(within(row).getByText('$5,000')).toBeInTheDocument();
  });

  it('hides the penalty (shows $0) when age >= 59.5', async () => {
    primeStores();
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );

    const ageInput = screen.getByLabelText(/age at withdrawal/i);
    fireEvent.change(ageInput, { target: { value: '67' } });

    const withdrawalInput = screen.getByLabelText(/withdrawal amount/i);
    fireEvent.change(withdrawalInput, { target: { value: '50000' } });

    const penaltyLabel = await screen.findByText(/early-withdrawal penalty/i);
    const row = penaltyLabel.closest('.flex.justify-between') as HTMLElement;
    expect(row).not.toBeNull();
    expect(within(row).getByText('$0')).toBeInTheDocument();
  });

  it('renders the "FICA — N/A on 401k withdrawals" notice once a breakdown is available', () => {
    primeStores();
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );
    // Wave 15 T6: the breakdown is gated behind a real withdrawal amount.
    fireEvent.change(screen.getByLabelText(/withdrawal amount/i), { target: { value: '50000' } });
    expect(screen.getByText(/^fica$/i)).toBeInTheDocument();
    expect(screen.getByText(/n\/a on 401k/i)).toBeInTheDocument();
  });

  it('shows the effective rate row once the user enters a withdrawal', async () => {
    primeStores();
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );

    const ageInput = screen.getByLabelText(/age at withdrawal/i);
    fireEvent.change(ageInput, { target: { value: '67' } });
    const withdrawalInput = screen.getByLabelText(/withdrawal amount/i);
    fireEvent.change(withdrawalInput, { target: { value: '50000' } });

    expect(await screen.findByText(/effective rate/i)).toBeInTheDocument();
  });

  it('renders a placeholder when household is not set', () => {
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(/set up your household profile/i),
    ).toBeInTheDocument();
  });

  it('empty-state CTA links to the destination it names (Wave 15 T10)', () => {
    // stores already reset — no household ⇒ no-breakdown empty state
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('link', { name: /set up your household profile/i }),
    ).toHaveAttribute('href', '/inputs/household');
  });

  it('surfaces "Estimated total taxes" and "Estimated net to you" as the two summary lines (Wave-3 Task 6 framing)', async () => {
    primeStores();
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/age at withdrawal/i), {
      target: { value: '67' },
    });
    fireEvent.change(screen.getByLabelText(/withdrawal amount/i), {
      target: { value: '50000' },
    });

    expect(await screen.findByText(/^estimated total taxes$/i)).toBeInTheDocument();
    expect(screen.getByText(/^estimated net to you$/i)).toBeInTheDocument();
    // Legacy ambiguous labels are gone.
    expect(screen.queryByText(/total tax on withdrawal/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^net to user$/i)).not.toBeInTheDocument();
  });

  it('renders the two summary rows with equal-weight styling', async () => {
    primeStores();
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/age at withdrawal/i), {
      target: { value: '67' },
    });
    fireEvent.change(screen.getByLabelText(/withdrawal amount/i), {
      target: { value: '50000' },
    });

    await screen.findByText(/^estimated total taxes$/i);
    const taxRow = screen.getByTestId('summary-taxes-paid');
    const netRow = screen.getByTestId('summary-net-to-you');
    expect(taxRow).not.toBeNull();
    expect(netRow).not.toBeNull();
    // Equal visual weight: same className signature on both summary rows so
    // neither one reads as "the answer" and the other as a footnote.
    expect(taxRow.className).toBe(netRow.className);
  });

  it('exposes a "What this calculator does NOT model" disclosure (Wave-3 Task 6)', async () => {
    primeStores();
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/age at withdrawal/i), {
      target: { value: '67' },
    });
    fireEvent.change(screen.getByLabelText(/withdrawal amount/i), {
      target: { value: '50000' },
    });

    expect(await screen.findByText(/what this calculator does NOT model/i)).toBeInTheDocument();
    // The disclosure body covers the named omissions. (Wave-5 NEW-W5-2:
    // NIIT was removed from this list once the calculator started routing
    // through the incremental-tax path. NIIT delta now appears as its
    // own breakdown line — see Retirement401kWithdrawalCard.niit.test.tsx.)
    expect(screen.getByText(/AMT/)).toBeInTheDocument();
    expect(screen.getByText(/Rule of 55/i)).toBeInTheDocument();
    expect(screen.getByText(/SEPP/)).toBeInTheDocument();
    // RMD appears twice now (NIIT row TermTooltip + RMD disclosure bullet),
    // so use getAllByText for safety.
    expect(screen.getAllByText(/RMD/).length).toBeGreaterThanOrEqual(1);
  });

  it('uses Net-to-you as the card headline (not take-home of the full salary)', async () => {
    primeStores();
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/age at withdrawal/i), {
      target: { value: '67' },
    });
    fireEvent.change(screen.getByLabelText(/withdrawal amount/i), {
      target: { value: '50000' },
    });

    const headline = await screen.findByTestId('401k-withdrawal-net');
    const netRow = screen.getByTestId('summary-net-to-you');
    // Headline value matches the Net-to-you line value so the meaning is
    // unambiguous: the big number is "what you keep", not "what tax you owe".
    expect(within(netRow).getByText(headline.textContent ?? '_MISMATCH_')).toBeInTheDocument();
  });

  // ── Wave 0c Task 5: golden net-to-user regression anchor ───────────────────
  // The card is being refactored to (a) adopt useHouseholdTaxContext (drop its
  // hand-rolled lookup/year-resolution) and (b) move its inputs onto the kit.
  // Both changes MUST be byte-identical for the tax math. This pins the exact
  // net-to-user the CURRENT card produces for a fully-specified seeded scenario
  // (withdrawal + W-2 + cap gains + other-inv-income at a sub-59½ age, so the
  // federal/state/city brackets, the per-jurisdiction standard deductions, the
  // NIIT delta, AND the early-withdrawal penalty all participate). A regression
  // in any of those paths flips this red.
  it('produces the same net-to-user after adopting the shared tax context (golden)', () => {
    primeStores();
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText(/withdrawal amount/i), { target: { value: '50000' } });
    fireEvent.change(screen.getByLabelText(/annual w-2 income/i), { target: { value: '120000' } });
    fireEvent.change(screen.getByLabelText(/capital gains for the year/i), { target: { value: '10000' } });
    fireEvent.change(screen.getByLabelText(/other investment income/i), { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText(/age at withdrawal/i), { target: { value: '50' } });
    expect(screen.getByTestId('401k-withdrawal-net').textContent).toBe('$30,500');
  });

  it('persists withdrawal + income overrides via the kit', async () => {
    const user = userEvent.setup();
    primeStores();
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );
    await user.clear(screen.getByLabelText(/withdrawal amount/i));
    await user.type(screen.getByLabelText(/withdrawal amount/i), '40000');
    expect(
      JSON.parse(sessionStorage.getItem('calc-state:retirement-401k-withdrawal')!),
    ).toMatchObject({
      withdrawalAmount: 40000,
    });
  });

  // a11y T7 finding 3: the "Plan type" radio group must have role="radiogroup"
  // with aria-label="Plan type" — a bare <span> cannot label a group, and radio
  // inputs without a group role are announced individually without context.
  it('Plan type radios are wrapped in role="radiogroup" with aria-label="Plan type"', () => {
    primeStores();
    render(
      <MemoryRouter>
        <Retirement401kWithdrawalCard />
      </MemoryRouter>,
    );
    const group = screen.getByRole('radiogroup', { name: 'Plan type' });
    expect(group).toBeInTheDocument();
    // Both radios must be exposed with role="radio" (Radix renders buttons).
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
  });

  it("is titled '401k withdrawal take-home' — the headline is net-to-you (wave-9)", async () => {
    primeStores();
    render(<MemoryRouter><Retirement401kWithdrawalCard /></MemoryRouter>);
    expect(await screen.findByText('401k withdrawal take-home')).toBeInTheDocument();
    expect(screen.queryByText('401k withdrawal tax')).not.toBeInTheDocument();
  });
});

describe('Roth assumption honesty (round-3 E3)', () => {
  it('ROTH at 59.5+ shows the qualified-distribution caveat', () => {
    primeStores();
    render(<MemoryRouter><Retirement401kWithdrawalCard /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Withdrawal amount/i), { target: { value: '40000' } });
    fireEvent.change(screen.getByLabelText(/Age at withdrawal/i), { target: { value: '65' } });
    fireEvent.click(screen.getByRole('radio', { name: /^Roth 401k$/i }));
    expect(screen.getByText(/assumes a qualified distribution/i)).toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('ROTH under 59.5 escalates to the warning banner', () => {
    primeStores();
    render(<MemoryRouter><Retirement401kWithdrawalCard /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/Withdrawal amount/i), { target: { value: '40000' } });
    fireEvent.change(screen.getByLabelText(/Age at withdrawal/i), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('radio', { name: /^Roth 401k$/i }));
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent(/before 59½/i);
    expect(note).toHaveTextContent(/earnings may be taxed and penalized/i);
    expect(note).toHaveTextContent(/doesn't model/i);
  });
});

describe('Retirement401kWithdrawalCard waymark meaning (Wave 17)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetStores();
  });

  it('renders the waymark meaning line from already-rendered values (Wave 17)', async () => {
    const user = userEvent.setup();
    primeStores();
    render(<MemoryRouter><Retirement401kWithdrawalCard cardId="retirement-401k-withdrawal" /></MemoryRouter>);
    const amount = screen.getByLabelText(/withdrawal amount/i);
    await user.clear(amount);
    await user.type(amount, '10000');
    expect(screen.getByTestId('retirement-401k-withdrawal-meaning')).toHaveTextContent(
      /net of an estimated .* tax on a .* withdrawal/i,
    );
  });

  it('empty state: headline —, cairn glyph, CTA sentence in the meaning slot', () => {
    // No household → no breakdown → empty waymark.
    render(<MemoryRouter><Retirement401kWithdrawalCard cardId="retirement-401k-withdrawal" /></MemoryRouter>);
    expect(screen.getByTestId('retirement-401k-withdrawal-headline')).toHaveTextContent('—');
    expect(document.querySelector('[data-testid="cairn-glyph"]')).toBeInTheDocument();
  });
});
