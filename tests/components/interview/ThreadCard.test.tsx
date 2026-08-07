import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InterviewThreads } from '@/components/interview/InterviewThreads';
import { useInterviewAnswersStore } from '@/stores/interview-answers-store';
import { answerKey, type InterviewAnswer } from '@/types/interview';
import { makeHousehold, makeVehicle } from '../../factories';
import { fixtureCtx } from '../../lib/interview/waterfall.test';

const CATS = [
  { id: 2, name: 'Vehicles', parentCategoryId: null, type: 'NEED' },
  { id: 18, name: 'Vehicle Maintenance', parentCategoryId: 2, type: 'NEED' },
] as never[];
const saveAnswer = vi.fn(async () => {});
const clearAnswer = vi.fn(async () => {});

const signalCtx = (answers = new Map<string, InterviewAnswer>()) => fixtureCtx({
  household: makeHousehold({ monthlyExpenseBaseline: 6000, growthScenarios: [{ label: 'moderate', rate: 0.05 }] }),
  vehicles: [makeVehicle({ id: 7, name: 'Old Wagon', year: 2014 })],
  categories: CATS,
  interviewAnswers: answers,
});

beforeEach(() => {
  vi.clearAllMocks();
  useInterviewAnswersStore.setState({ saveAnswer, clearAnswer } as never);
});

describe('InterviewThreads / ThreadCard', () => {
  it('renders nothing at all when no thread surfaces (no false empty state)', () => {
    const { container } = render(<InterviewThreads ctx={fixtureCtx()} />);
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
        answeredAt: '2026-07-01T00:00:00.000Z', basisJson: '{"branch":"signal"}',
      },
    ]]);
    render(<InterviewThreads ctx={signalCtx(answers)} />);
    expect(screen.getByText(/Nothing computed — you said no replacement plans/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ask me again' }));
    await waitFor(() =>
      expect(clearAnswer).toHaveBeenCalledWith('vehicle_replacement', 'q_keep_horizon', 'vehicle:7'));
  });

  it('an age-stale answer shows the CI-34 banner with Still true / Change answer', () => {
    const answers = new Map([[
      answerKey('vehicle_replacement', 'q_keep_horizon', 'vehicle:7'),
      {
        id: 1, householdId: 1, threadId: 'vehicle_replacement', questionId: 'q_keep_horizon',
        subjectKey: 'vehicle:7', valueJson: '"no-plans"', questionVersion: 1,
        answeredAt: '2025-06-01T00:00:00.000Z', basisJson: '{"branch":"signal"}',
      },
    ]]);
    render(<InterviewThreads ctx={signalCtx(answers)} />);
    expect(screen.getByText('Answered June 2025 — still true?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Still true' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change answer' })).toBeInTheDocument();
  });
});
