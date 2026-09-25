import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { z } from 'zod';
import { InterviewThreads } from '@/components/interview/InterviewThreads';
import { ThreadCard } from '@/components/interview/ThreadCard';
import type { InterviewThread, PreferenceNode, ThreadEvaluation } from '@/types/interview';
import { useInterviewAnswersStore } from '@/stores/interview-answers-store';
import { useAcceptancesStore } from '@/stores/disclosure-acceptances-store';
import { useHouseholdStore } from '@/stores/household-store';
import { DISCLOSURES } from '@/legal/disclosures';
import { answerKey, type InterviewAnswer } from '@/types/interview';
import { AccountType, PropertyType } from '@/types/enums';
import { makeAccount, makeHousehold, makeVehicle, makeProperty } from '../../factories';
import { fixtureCtx, snap } from '../../lib/interview/fixture';

const CATS = [
  { id: 2, name: 'Vehicles', parentCategoryId: null, type: 'NEED' },
  { id: 18, name: 'Vehicle Maintenance', parentCategoryId: 2, type: 'NEED' },
] as never[];
const saveAnswer = vi.fn(async () => {});
const clearAnswer = vi.fn(async () => {});

// Owner household (Wave T2): a PRIMARY_RESIDENCE hides the home_purchase
// thread (D-HP1), keeping this suite's vehicle-only premises intact —
// without it the bare fixture's unknown tenure surfaces the house ask.
const signalCtx = (answers = new Map<string, InterviewAnswer>()) => fixtureCtx({
  household: makeHousehold({ monthlyExpenseBaseline: 6000, growthScenarios: [{ label: 'moderate', rate: 0.05 }] }),
  vehicles: [makeVehicle({ id: 7, name: 'Old Wagon', year: 2014 })],
  categories: CATS,
  properties: [makeProperty({ id: 1, type: PropertyType.PRIMARY_RESIDENCE })],
  interviewAnswers: answers,
});

beforeEach(() => {
  vi.clearAllMocks();
  useInterviewAnswersStore.setState({ saveAnswer, clearAnswer } as never);
  // R4 (D-R4-7): the strip is gated on the interview document — accept the
  // current version so the existing submits are not intercepted (the
  // QuestionBar.test idiom).
  useAcceptancesStore.setState({ acceptedVersions: { interview: DISCLOSURES.interview.version } } as never);
});

describe('InterviewThreads / ThreadCard', () => {
  it('renders nothing at all when no thread surfaces (no false empty state)', () => {
    // Owner household: with Wave T2's home_purchase registered, a bare
    // fixture (unknown tenure) would honestly ask CI-H1 — the premise
    // here is "no thread surfaces", so make the household an owner.
    const ctx = fixtureCtx({ properties: [makeProperty({ id: 1, type: PropertyType.PRIMARY_RESIDENCE })] });
    const { container } = render(<InterviewThreads ctx={ctx} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('a firing signal renders the strip heading + the enum ask; answering saves with the pinned basis', async () => {
    render(<InterviewThreads ctx={signalCtx()} />);
    expect(screen.getByRole('heading', { name: 'Questions for you' })).toBeInTheDocument();
    expect(screen.getByText('Are there plans to replace Old Wagon?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'No plans' }));
    await waitFor(() => expect(saveAnswer).toHaveBeenCalledOnce());
    const arg = saveAnswer.mock.calls[0][0];
    expect(arg).toMatchObject({
      threadId: 'vehicle_replacement', questionId: 'q_keep_horizon',
      subjectKey: 'vehicle:7', value: 'no-plans', questionVersion: 1,
    });
    expect((arg.basis as { branch: string }).branch).toBe('signal');
  });

  it('a reply renders its lines + "Ask me again", which clears the row (CI-35)', async () => {
    const answers = new Map([[
      answerKey('vehicle_replacement', 'q_keep_horizon', 'vehicle:7'),
      {
        id: 1, householdId: 1, threadId: 'vehicle_replacement', questionId: 'q_keep_horizon',
        subjectKey: 'vehicle:7', valueJson: '"no-plans"', questionVersion: 1,
        answeredAt: '2026-07-01T12:00:00.000Z', basisJson: '{"branch":"signal"}',
      },
    ]]);
    render(<InterviewThreads ctx={signalCtx(answers)} />);
    expect(screen.getByText(/Nothing computed — you said no replacement plans/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Ask me again/ }));
    await waitFor(() =>
      expect(clearAnswer).toHaveBeenCalledWith('vehicle_replacement', 'q_keep_horizon', 'vehicle:7'));
  });

  it('an age-stale answer shows the CI-34 banner with Still true / Change answer', () => {
    const answers = new Map([[
      answerKey('vehicle_replacement', 'q_keep_horizon', 'vehicle:7'),
      {
        id: 1, householdId: 1, threadId: 'vehicle_replacement', questionId: 'q_keep_horizon',
        subjectKey: 'vehicle:7', valueJson: '"no-plans"', questionVersion: 1,
        answeredAt: '2025-06-01T12:00:00.000Z', basisJson: '{"branch":"signal"}',
      },
    ]]);
    render(<InterviewThreads ctx={signalCtx(answers)} />);
    expect(screen.getByText('Answered June 2025 — still true?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Still true' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change answer' })).toBeInTheDocument();
  });
});

describe('write-path validation (review m4)', () => {
  it('a value failing the node schema never reaches the repo — inline error instead', async () => {
    // The node's schema is stricter than the amount control's own bounds, so
    // the control CAN produce a schema-invalid value. It must fail loudly
    // into AnswerPrompt's inline error path, never persist.
    const node: PreferenceNode = {
      kind: 'preference', id: 'q_test', version: 1, prompt: 'How much?',
      answer: { kind: 'amount', maxDollars: 10_000_000 },
      valueSchema: z.number().min(500),
      storage: { kind: 'interview-answer' },
      branches: { '*': 'r' },
    };
    const thread = { id: 't', title: 'T', scope: 'household', entry: 'q_test', nodes: [node] } as InterviewThread;
    const evaluation: ThreadEvaluation = {
      state: 'ask', node, subject: '', reason: 'unanswered', priorAnswer: null, pinBasis: null,
    };
    render(<ThreadCard thread={thread} subject="" ctx={fixtureCtx()} evaluation={evaluation} />);
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not save your answer.'));
    expect(saveAnswer).not.toHaveBeenCalled();
  });
});

describe('Ask me again accessible names (review m7)', () => {
  it('multi-answer replies expose one distinctly-named button per question (visible text unchanged)', () => {
    const answers = new Map([
      [
        answerKey('vehicle_replacement', 'q_keep_horizon', 'vehicle:7'),
        {
          id: 1, householdId: 1, threadId: 'vehicle_replacement', questionId: 'q_keep_horizon',
          subjectKey: 'vehicle:7', valueJson: '"replace-within-2y"', questionVersion: 1,
          answeredAt: '2026-07-01T12:00:00.000Z', basisJson: '{"branch":"signal"}',
        },
      ],
      [
        answerKey('vehicle_replacement', 'q_replacement_budget', 'vehicle:7'),
        {
          id: 2, householdId: 1, threadId: 'vehicle_replacement', questionId: 'q_replacement_budget',
          subjectKey: 'vehicle:7', valueJson: '30000', questionVersion: 1,
          answeredAt: '2026-07-01T12:00:00.000Z', basisJson: '{"branch":"signal"}',
        },
      ],
    ]);
    render(<InterviewThreads ctx={signalCtx(answers)} />);
    // Two adjacent buttons, byte-identical CI-35 visible text…
    const visible = screen.getAllByText('Ask me again');
    expect(visible).toHaveLength(2);
    // …but distinct ACCESSIBLE names (a11y metadata only).
    expect(screen.getByRole('button', { name: 'Ask me again: Are there plans to replace Old Wagon?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask me again: About how much would the replacement cost?' })).toBeInTheDocument();
  });
});

describe('U10 — "Answered {Month}" is the LOCAL month of the instant (America/Los_Angeles)', () => {
  const ORIGINAL_TZ = process.env.TZ;
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });
  it('03:00Z on Sep 1 2025 is Aug 31 locally → "Answered August 2025" (the UTC month read September)', () => {
    process.env.TZ = 'America/Los_Angeles';
    const answers = new Map([[
      answerKey('vehicle_replacement', 'q_keep_horizon', 'vehicle:7'),
      {
        id: 1, householdId: 1, threadId: 'vehicle_replacement', questionId: 'q_keep_horizon',
        subjectKey: 'vehicle:7', valueJson: '"no-plans"', questionVersion: 1,
        answeredAt: '2025-09-01T03:00:00.000Z', basisJson: '{"branch":"signal"}',
      },
    ]]);
    // fixture today = local 2026-08-01; local 2025-08-31 → 12 months → stale (the UTC day 2025-09-01 → 11 → no banner at all)
    render(<InterviewThreads ctx={signalCtx(answers)} />);
    expect(screen.getByText('Answered August 2025 — still true?')).toBeInTheDocument();
  });
});

describe('F12 — the CI-36 prior label is formatted BY KIND (never String(value))', () => {
  const compoundNode: PreferenceNode = {
    kind: 'preference', id: 'q_target', version: 2, prompt: 'About how much would the down payment be, and by when?',
    answer: { kind: 'amount-month-year', maxDollars: 10_000_000 },
    valueSchema: z.object({ amountDollars: z.number().positive(), targetMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }),
    storage: { kind: 'interview-answer' }, branches: { '*': 'r' },
  };
  const thread = { id: 't', title: 'T', scope: 'household', entry: 'q_target', nodes: [compoundNode] } as InterviewThread;
  it('a version-changed compound prior renders "$60,000 by June 2028"', () => {
    const evaluation: ThreadEvaluation = {
      state: 'ask', node: compoundNode, subject: '', reason: 'version-changed', pinBasis: null,
      priorAnswer: { value: { amountDollars: 60000, targetMonth: '2028-06' }, questionVersion: 1, answeredAt: '2026-07-01T12:00:00.000Z', basis: null },
    };
    render(<ThreadCard thread={thread} subject="" ctx={fixtureCtx()} evaluation={evaluation} />);
    expect(screen.getByText("This question changed since you answered. Your earlier answer: '$60,000 by June 2028'.")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('[object Object]');
  });
  it('an unparseable prior renders NO preamble (D-GI16: never undefined, never garbage)', () => {
    const evaluation: ThreadEvaluation = {
      state: 'ask', node: compoundNode, subject: '', reason: 'version-changed', pinBasis: null,
      priorAnswer: { value: { targetMonth: 12 }, questionVersion: 1, answeredAt: '2026-07-01T12:00:00.000Z', basis: null },
    };
    render(<ThreadCard thread={thread} subject="" ctx={fixtureCtx()} evaluation={evaluation} />);
    expect(screen.queryByText(/This question changed since you answered/)).toBeNull();
  });
});

describe('CI-34 "Still true" re-persists the PARSED value (R4 D-R4-P11 — the college shim retires by normalizing on write)', () => {
  it('a legacy compound q_target_year row re-confirms as the bare "YYYY-MM"', async () => {
    const collegeRow = (questionId: string, valueJson: string, answeredAt: string, branch: string): [string, InterviewAnswer] => [
      answerKey('college_vs_retirement', questionId, ''),
      { id: 1, householdId: 1, threadId: 'college_vs_retirement', questionId, subjectKey: '', valueJson, questionVersion: 1, answeredAt, basisJson: JSON.stringify({ branch }) },
    ];
    const ctx = fixtureCtx({
      household: makeHousehold({ monthlyExpenseBaseline: 6000, inflationAssumption: 0.03, growthScenarios: [{ label: 'moderate', rate: 0.05 }] }),
      properties: [makeProperty({ id: 1, type: PropertyType.PRIMARY_RESIDENCE })], // owner: no home card
      accounts: [makeAccount({ id: 9, type: AccountType.ACCOUNT_529, name: 'College 529' })],
      snapshots: [snap(9, 10_000)],
      interviewAnswers: new Map([
        // 31 months old → stale (staleAfterMonths 24) → the CI-34 banner; the legacy T3 shape.
        collegeRow('q_target_year', '{"amountDollars":123,"targetMonth":"2030-09"}', '2024-01-01T12:00:00.000Z', 'no-dependents-529'),
        collegeRow('q_monthly_amount', '500', '2026-07-01T12:00:00.000Z', 'has-529'),
      ]),
    });
    render(<InterviewThreads ctx={ctx} />);
    expect(screen.getByText('Answered January 2024 — still true?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Still true' }));
    await waitFor(() => expect(saveAnswer).toHaveBeenCalledOnce());
    expect(saveAnswer.mock.calls[0][0]).toMatchObject({
      threadId: 'college_vs_retirement', questionId: 'q_target_year', subjectKey: '',
      value: '2030-09', questionVersion: 1,
    });
  });

  it('the re-confirm keeps the row\'s pinned basis FACTS (R4 review MINOR 0) — the value gains the new shape, basis_json keeps { branch, ...facts }', async () => {
    const ctx = fixtureCtx({
      household: makeHousehold({ monthlyExpenseBaseline: 6000, inflationAssumption: 0.03, growthScenarios: [{ label: 'moderate', rate: 0.05 }] }),
      properties: [makeProperty({ id: 1, type: PropertyType.PRIMARY_RESIDENCE })],
      accounts: [makeAccount({ id: 9, type: AccountType.ACCOUNT_529, name: 'College 529' })],
      snapshots: [snap(9, 10_000)],
      interviewAnswers: new Map([
        [answerKey('college_vs_retirement', 'q_target_year', ''), {
          id: 1, householdId: 1, threadId: 'college_vs_retirement', questionId: 'q_target_year', subjectKey: '',
          valueJson: '{"amountDollars":123,"targetMonth":"2030-09"}', questionVersion: 1, answeredAt: '2024-01-01T12:00:00.000Z',
          // d_dependents' pinned basis as the ask state writes it: { branch, ...facts }.
          basisJson: '{"branch":"no-dependents-529","dependentCount":0,"count529":1}',
        }],
        [answerKey('college_vs_retirement', 'q_monthly_amount', ''), {
          id: 2, householdId: 1, threadId: 'college_vs_retirement', questionId: 'q_monthly_amount', subjectKey: '',
          valueJson: '500', questionVersion: 1, answeredAt: '2026-07-01T12:00:00.000Z',
          basisJson: '{"branch":"has-529","accountCount":1,"hasSnapshot":true}',
        }],
      ]),
    });
    render(<InterviewThreads ctx={ctx} />);
    fireEvent.click(screen.getByRole('button', { name: 'Still true' }));
    await waitFor(() => expect(saveAnswer).toHaveBeenCalledOnce());
    const arg = saveAnswer.mock.calls[0][0];
    expect(arg).toMatchObject({ questionId: 'q_target_year', value: '2030-09', questionVersion: 1 });
    expect(arg.basis).toEqual({ branch: 'no-dependents-529', dependentCount: 0, count529: 1 });
  });
});

describe('the strip gate (R4 D-R4-7 / D-R4-P6) — the bar\'s modal semantics on every thread; the reply RENDER is gated too', () => {
  const acceptDisclaimer = vi.fn(async () => {});
  beforeEach(() => {
    useHouseholdStore.setState({ acceptDisclaimer } as never);
  });
  const replyAnswers = () => new Map([[
    answerKey('vehicle_replacement', 'q_keep_horizon', 'vehicle:7'),
    {
      id: 1, householdId: 1, threadId: 'vehicle_replacement', questionId: 'q_keep_horizon',
      subjectKey: 'vehicle:7', valueJson: '"no-plans"', questionVersion: 1,
      answeredAt: '2026-07-01T12:00:00.000Z', basisJson: '{"branch":"signal"}',
    },
  ]]);

  it('never-accepted: the first strip answer opens the id-generic modal — body + attestation, NO "What changed" box — and saves nothing', () => {
    useAcceptancesStore.setState({ acceptedVersions: {} } as never);
    render(<InterviewThreads ctx={signalCtx()} />);
    fireEvent.click(screen.getByRole('button', { name: 'No plans' }));
    expect(screen.getByText('About the Frameworks')).toBeInTheDocument();
    expect(screen.getByText('Version 1.2')).toBeInTheDocument();
    expect(screen.queryByText('What changed since you last accepted:')).toBeNull();
    expect(screen.getByRole('checkbox', { name: DISCLOSURES.interview.acceptanceCheckboxLabel })).toBeInTheDocument();
    expect(saveAnswer).not.toHaveBeenCalled();
  });

  it('Escape does not dismiss; Cancel closes and saves nothing', () => {
    useAcceptancesStore.setState({ acceptedVersions: {} } as never);
    render(<InterviewThreads ctx={signalCtx()} />);
    fireEvent.click(screen.getByRole('button', { name: 'No plans' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByText('About the Frameworks')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('About the Frameworks')).toBeNull();
    expect(saveAnswer).not.toHaveBeenCalled();
  });

  it('accept → acceptDisclaimer("interview", "1.2") → the pending answer saves with its basis', async () => {
    useAcceptancesStore.setState({ acceptedVersions: {} } as never);
    render(<InterviewThreads ctx={signalCtx()} />);
    fireEvent.click(screen.getByRole('button', { name: 'No plans' }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(acceptDisclaimer).toHaveBeenCalledWith('interview', DISCLOSURES.interview.version));
    await waitFor(() => expect(saveAnswer).toHaveBeenCalledOnce());
    expect(saveAnswer.mock.calls[0][0]).toMatchObject({ questionId: 'q_keep_horizon', value: 'no-plans' });
  });

  it('a deferred save that REJECTS after accept says so under the prompt — the shipped fallback, never the raw error (R4 review MINOR 7)', async () => {
    useAcceptancesStore.setState({ acceptedVersions: {} } as never);
    saveAnswer.mockRejectedValueOnce(new Error('SQLITE_BUSY: database is locked'));
    render(<InterviewThreads ctx={signalCtx()} />);
    fireEvent.click(screen.getByRole('button', { name: 'No plans' }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(saveAnswer).toHaveBeenCalledOnce());
    const card = screen.getByTestId('thread-vehicle_replacement-vehicle:7');
    await waitFor(() => expect(within(card).getByRole('alert')).toHaveTextContent('Could not save your answer.'));
    expect(within(card).getByRole('alert').textContent).toBe('Could not save your answer.');
    expect(screen.queryByText('About the Frameworks')).toBeNull(); // the modal is gone; the card carries the message
    expect(screen.getByText('Are there plans to replace Old Wagon?')).toBeInTheDocument(); // the ask is still there to retry
  });

  it('a deferred save that RESOLVES after accept renders no error line', async () => {
    useAcceptancesStore.setState({ acceptedVersions: {} } as never);
    render(<InterviewThreads ctx={signalCtx()} />);
    fireEvent.click(screen.getByRole('button', { name: 'No plans' }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(saveAnswer).toHaveBeenCalledOnce());
    await act(async () => {}); // let the awaited save settle
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Could not save your answer.')).toBeNull();
  });

  it('a household that accepted 1.1 is re-gated at 1.2 and reads the "What changed" box with the interview diff (R3\'s rule)', () => {
    useAcceptancesStore.setState({ acceptedVersions: { interview: '1.1' } } as never);
    render(<InterviewThreads ctx={signalCtx()} />);
    fireEvent.click(screen.getByRole('button', { name: 'No plans' }));
    expect(screen.getByText('What changed since you last accepted:')).toBeInTheDocument();
    expect(screen.getByText(DISCLOSURES.interview.diffFromPrevious as string)).toBeInTheDocument();
  });

  it('a household on 1.2 is never gated: the answer saves at once', async () => {
    render(<InterviewThreads ctx={signalCtx()} />);
    fireEvent.click(screen.getByRole('button', { name: 'No plans' }));
    await waitFor(() => expect(saveAnswer).toHaveBeenCalledOnce());
    expect(screen.queryByText('About the Frameworks')).toBeNull();
  });

  it('a REPLY card under needs-acceptance renders the title + CR-GATE-1 + "Read and accept" and none of its lines; acceptance reveals them', async () => {
    useAcceptancesStore.setState({ acceptedVersions: {} } as never);
    render(<InterviewThreads ctx={signalCtx(replyAnswers())} />);
    expect(screen.getByText('Vehicle replacement')).toBeInTheDocument();
    expect(screen.getByText('Accept the About the Frameworks disclosure to see this card.')).toBeInTheDocument();
    expect(screen.queryByText(/Nothing computed — you said no replacement plans/)).toBeNull();
    expect(screen.queryByText('Ask me again')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Read and accept the Frameworks disclosure' }));
    expect(screen.getByText('About the Frameworks')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(acceptDisclaimer).toHaveBeenCalledWith('interview', DISCLOSURES.interview.version));
    // The real acceptDisclaimer writes the row and the acceptances projection reloads; mirror that here.
    act(() => { useAcceptancesStore.setState({ acceptedVersions: { interview: DISCLOSURES.interview.version } } as never); });
    expect(screen.getByText(/Nothing computed — you said no replacement plans/)).toBeInTheDocument();
    expect(screen.queryByText('Accept the About the Frameworks disclosure to see this card.')).toBeNull();
  });
});

describe('⚑ R4-F16 receipt: the strip fixture\'s $30,000 cash/savings never surfaces market_stress; an invested balance does', () => {
  it('bare owner fixture: nothing renders (the "no false empty state" pin above survives unchanged)', () => {
    const { container } = render(<InterviewThreads ctx={fixtureCtx({ properties: [makeProperty({ id: 1, type: PropertyType.PRIMARY_RESIDENCE })] })} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('a brokerage snapshot surfaces the mix question', () => {
    const ctx = fixtureCtx({
      properties: [makeProperty({ id: 1, type: PropertyType.PRIMARY_RESIDENCE })],
      accounts: [...fixtureCtx().accounts, makeAccount({ id: 3, type: AccountType.ACCOUNT_BROKERAGE, name: 'Brokerage' })],
      snapshots: [...fixtureCtx().snapshots, snap(3, 100_000)],
    });
    render(<InterviewThreads ctx={ctx} />);
    expect(screen.getByTestId('thread-market_stress-')).toHaveTextContent('How is your portfolio split between stocks and bonds?');
  });
});
