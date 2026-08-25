import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { InterviewThreads } from '@/components/interview/InterviewThreads';
import { useInterviewAnswersStore } from '@/stores/interview-answers-store';
import { useHouseholdStore } from '@/stores/household-store';
import { useGoalsStore } from '@/stores/goals-store';
import { GoalType } from '@/types/enums';
import { answerKey, type InterviewAnswer, type InterviewContext } from '@/types/interview';
import { makeHousehold } from '../../factories';
import { fixtureCtx } from '../../lib/interview/fixture';
import type { HousingPayment } from '@/types/schema';

vi.mock('@/lib/use-local-today', () => ({ useLocalToday: () => '2026-08-01' }));

const rent = (): HousingPayment => ({
  id: 1, householdId: 1, ownerPersonId: null, name: 'Rent',
  monthlyAmount: 2200, startDate: '2025-01-01', endDate: null,
} as HousingPayment);

const renterCtx = (answers: Map<string, InterviewAnswer> = new Map(), extra: Partial<InterviewContext> = {}) =>
  fixtureCtx({
    household: makeHousehold({ monthlyExpenseBaseline: 6000, growthScenarios: [{ label: 'moderate', rate: 0.05 }] }),
    housingPayments: [rent()],
    interviewAnswers: answers,
    ...extra,
  });

const row = (questionId: string, valueJson: string): [string, InterviewAnswer] => [
  answerKey('home_purchase', questionId, ''),
  {
    id: 1, householdId: 1, threadId: 'home_purchase', questionId, subjectKey: '',
    valueJson, questionVersion: 1, answeredAt: '2026-07-01T00:00:00.000Z',
    basisJson: '{"branch":"not-owner"}',
  },
];

const saveAnswer = vi.fn(async () => {});
const clearAnswer = vi.fn(async () => {});
const update = vi.fn(async () => {});
const createGoal = vi.fn(async () => 1);

const renderThreads = (ctx: InterviewContext) =>
  render(<MemoryRouter><InterviewThreads ctx={ctx} /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  useInterviewAnswersStore.setState({ saveAnswer, clearAnswer } as never);
  useHouseholdStore.setState({ household: { id: 1 }, update } as never);
  useGoalsStore.setState({ goals: [], error: null, create: createGoal } as never);
});

describe('home_purchase on the strip', () => {
  it('asks CI-H1 with three typed options; answering pins the not-owner basis', async () => {
    renderThreads(renterCtx());
    expect(screen.getByText('Are there plans to buy a home?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Within 5 years' }));
    await waitFor(() => expect(saveAnswer).toHaveBeenCalledOnce());
    expect(saveAnswer.mock.calls[0][0]).toMatchObject({
      threadId: 'home_purchase', questionId: 'q_want_house', subjectKey: '',
      value: 'yes-within-5y', questionVersion: 1,
    });
    expect((saveAnswer.mock.calls[0][0].basis as { branch: string }).branch).toBe('not-owner');
  });

  it('q_target renders the compound control; Save persists AND write-throughs the household', async () => {
    renderThreads(renterCtx(new Map([row('q_want_house', '"yes-within-5y"')])));
    const card = screen.getByTestId('thread-home_purchase-');
    expect(within(card).getByText('About how much would the down payment be, and by when?')).toBeInTheDocument();
    fireEvent.change(within(card).getByLabelText('Amount'), { target: { value: '60000' } });
    fireEvent.change(within(card).getByLabelText('Month'), { target: { value: '06' } });
    fireEvent.change(within(card).getByLabelText('Year'), { target: { value: '2028' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveAnswer).toHaveBeenCalledOnce());
    expect(saveAnswer.mock.calls[0][0]).toMatchObject({
      questionId: 'q_target', value: { amountDollars: 60000, targetMonth: '2028-06' },
    });
    // D-HP4: the dispatch ran (2026-08 → 2028-06 = 22 months, within window).
    await waitFor(() => expect(update).toHaveBeenCalledWith({
      upcomingLargePurchase: true, upcomingPurchaseAmount: 60000, upcomingPurchaseMonths: 22,
    }));
  });

  it('the plan reply renders with the CTA; clicking creates the exact DOWN_PAYMENT goal (CI-H17)', async () => {
    renderThreads(renterCtx(new Map([
      row('q_want_house', '"yes-within-5y"'),
      row('q_target', '{"amountDollars":60000,"targetMonth":"2028-06"}'),
    ])));
    const card = screen.getByTestId('thread-home_purchase-');
    expect(within(card).getByText(/Saving \$1,364\/mo reaches \$60,000 by June 2028/)).toBeInTheDocument();
    expect(within(card).getByText(
      'Creates a $60,000 down-payment goal targeting June 2028 — link accounts to it on the Goals page to track progress.',
    )).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'Track this as a Goal' }));
    await waitFor(() => expect(createGoal).toHaveBeenCalledWith({
      householdId: 1, forPersonId: null, name: 'Home down payment',
      type: GoalType.DOWN_PAYMENT, targetAmount: 60000, targetDate: '2028-06-01',
      linkedAccountIds: [],
    }));
  });

  it('D-HP6: an existing DOWN_PAYMENT goal shows the tracked state — no button, no duplicate', () => {
    useGoalsStore.setState({
      goals: [{ id: 9, householdId: 1, forPersonId: null, name: 'Home down payment', type: GoalType.DOWN_PAYMENT, targetAmount: 60000, targetDate: '2028-06-01', linkedAccountIds: [] }],
      create: createGoal,
    } as never);
    renderThreads(renterCtx(new Map([
      row('q_want_house', '"yes-within-5y"'),
      row('q_target', '{"amountDollars":60000,"targetMonth":"2028-06"}'),
    ])));
    const card = screen.getByTestId('thread-home_purchase-');
    expect(within(card).getByText('Tracked as a Goal — Home down payment.')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Open Goals →' })).toHaveAttribute('href', '/goals');
    expect(within(card).queryByRole('button', { name: 'Track this as a Goal' })).toBeNull();
  });

  it('f4 (review): a failed goals load suppresses the create button (dedup cannot be trusted over an errored list)', () => {
    useGoalsStore.setState({ goals: [], error: 'DB gone', create: createGoal } as never);
    renderThreads(renterCtx(new Map([
      row('q_want_house', '"yes-within-5y"'),
      row('q_target', '{"amountDollars":60000,"targetMonth":"2028-06"}'),
    ])));
    const card = screen.getByTestId('thread-home_purchase-');
    // The plan card itself still renders; only the goal-creating affordance
    // is withheld while the dedup read is unreliable (D-HP6).
    expect(within(card).getByText(/Saving \$1,364\/mo/)).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Track this as a Goal' })).toBeNull();
    expect(within(card).queryByText(/Tracked as a Goal/)).toBeNull();
  });

  it('f5 (review): a goal appearing after render still cannot be duplicated (the D-HP6 click-time leg)', () => {
    renderThreads(renterCtx(new Map([
      row('q_want_house', '"yes-within-5y"'),
      row('q_target', '{"amountDollars":60000,"targetMonth":"2028-06"}'),
    ])));
    const card = screen.getByTestId('thread-home_purchase-');
    const button = within(card).getByRole('button', { name: 'Track this as a Goal' });
    act(() => {
      // A concurrent surface (Goals page, another window) lands a
      // DOWN_PAYMENT goal between render and click.
      useGoalsStore.setState({
        goals: [{ id: 9, householdId: 1, forPersonId: null, name: 'Home down payment', type: GoalType.DOWN_PAYMENT, targetAmount: 60000, targetDate: '2028-06-01', linkedAccountIds: [] }],
      } as never);
      fireEvent.click(button);
    });
    expect(createGoal).not.toHaveBeenCalled();
  });

  it('f5 (review): the button disables while the create is pending', async () => {
    let resolveCreate!: (id: number) => void;
    createGoal.mockImplementationOnce(() => new Promise<number>((resolve) => { resolveCreate = resolve; }));
    renderThreads(renterCtx(new Map([
      row('q_want_house', '"yes-within-5y"'),
      row('q_target', '{"amountDollars":60000,"targetMonth":"2028-06"}'),
    ])));
    const card = screen.getByTestId('thread-home_purchase-');
    const button = within(card).getByRole('button', { name: 'Track this as a Goal' });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    resolveCreate(1);
    await waitFor(() => expect(button).toBeEnabled());
  });

  it('both answered questions expose Ask me again (aria-disambiguated, m7 behavior)', () => {
    renderThreads(renterCtx(new Map([
      row('q_want_house', '"yes-within-5y"'),
      row('q_target', '{"amountDollars":60000,"targetMonth":"2028-06"}'),
    ])));
    const card = screen.getByTestId('thread-home_purchase-');
    expect(within(card).getAllByText('Ask me again')).toHaveLength(2);
  });
});
