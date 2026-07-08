import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useHouseholdStore } from '@/stores/household-store';
import { useLearningStore } from '@/stores/learning-state-store';
import { useAcceptancesStore } from '@/stores/disclosure-acceptances-store';
import { QuestionFormat, Topic } from '@/types/enums';
import type { TriviaQuestion } from '@/lib/trivia/bank-schema';
import { TodaysTriviaCard } from '@/components/dashboard/TodaysTriviaCard';

// The store's REAL load — the MUST-1 loading test stubs it; boot() restores it.
const realLearningLoad = useLearningStore.getState().load;

const sql = (name: string) =>
  readFileSync(resolve(__dirname, `../../src/db/migrations/${name}.sql`), 'utf-8');

// Same fixture-isolation pattern as Learn.test.tsx (panel Testing H3): a known
// reviewed bank so "0 of 4 / 1 of 4 / done" are deterministic against a fixed set
// size, not the live 60.
const qt = (id: string, difficulty: 'Beginner' | 'Advanced', topic: Topic): TriviaQuestion => ({
  id,
  version: 1,
  difficulty,
  format: QuestionFormat.DEFINITION,
  topic,
  prompt: `Prompt for ${id}`,
  choices: [`${id}-c0`, `${id}-c1`, `${id}-c2`, `${id}-c3`],
  answerIndex: 0,
  explanation: `Explanation for ${id}`,
  source: 'IRS Pub 17',
  reviewed: true,
});

const FIXTURE_BANK: TriviaQuestion[] = [
  qt('beg-found', 'Beginner', Topic.FOUNDATIONS),
  qt('beg-budget', 'Beginner', Topic.BUDGETING),
  qt('adv-invest', 'Advanced', Topic.INVESTMENTS),
  qt('adv-tax', 'Advanced', Topic.TAXES),
];

vi.mock('@/lib/trivia/load-bank', async () => {
  const actual = await vi.importActual<typeof import('@/lib/trivia/load-bank')>(
    '@/lib/trivia/load-bank',
  );
  return { ...actual, loadTriviaBank: vi.fn(async () => FIXTURE_BANK) };
});

async function boot(open: boolean): Promise<SqliteAdapter> {
  const db = new SqliteAdapter(':memory:');
  await runMigrations(db, [
    { version: '0001_initial', sql: sql('0001_initial') },
    { version: '0017_disclosure_foundations', sql: sql('0017_disclosure_foundations') },
    { version: '0037_learning_state', sql: sql('0037_learning_state') },
    { version: '0048_learning_preference_default', sql: sql('0048_learning_preference_default') },
  ]);
  setDatabase(db);
  useHouseholdStore.setState({ household: null, isLoading: false, error: null });
  useAcceptancesStore.setState({ acceptedVersions: {}, status: 'ready', isLoading: false, error: null });
  useLearningStore.setState({
    learningState: null,
    answeredQuestionIds: [],
    answeredKeysByDay: { priorDays: [], today: [], todayDetails: [] },
    answeredStats: null,
    isLoading: false,
    error: null,
    load: realLearningLoad,
  });
  if (open) {
    await db.execute(
      `INSERT INTO disclosure_acceptances (household_id, document_id, version, accepted_at)
       VALUES (1, 'learning', '1.0', '2026-05-28T00:00:00Z')`,
    );
  }
  await useHouseholdStore.getState().load();
  await useAcceptancesStore.getState().load();
  await useLearningStore.getState().load();
  return db;
}

describe('TodaysTriviaCard (X of 4)', () => {
  let db: SqliteAdapter;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 4, 28, 12, 0, 0));
  });

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await db?.close();
    vi.useRealTimers();
  });

  it('shows "0 of 4" + Start when none are answered', async () => {
    db = await boot(true);
    render(
      <MemoryRouter>
        <TodaysTriviaCard />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/0 of 4 answered/i)).toBeInTheDocument();
    expect(screen.getByText(/start →/i)).toBeInTheDocument();
  });

  it('shows "1 of 4" + Continue after one is answered today', async () => {
    db = await boot(true);
    // Answer one of today's set (its key lands in answeredKeysByDay.today).
    await useLearningStore.getState().recordAnswer({
      questionId: 'beg-found',
      answeredIsoDate: '2026-05-28',
      chosenIndex: 0,
      wasCorrect: true,
      questionVersion: 1,
    });
    render(
      <MemoryRouter>
        <TodaysTriviaCard />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/1 of 4 answered/i)).toBeInTheDocument();
    expect(screen.getByText(/continue →/i)).toBeInTheDocument();
  });

  it('shows the done state when all 4 are answered today', async () => {
    db = await boot(true);
    for (const id of ['beg-found', 'beg-budget', 'adv-invest', 'adv-tax']) {
      await useLearningStore.getState().recordAnswer({
        questionId: id,
        answeredIsoDate: '2026-05-28',
        chosenIndex: 0,
        wasCorrect: true,
        questionVersion: 1,
      });
    }
    render(
      <MemoryRouter>
        <TodaysTriviaCard />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/done/i)).toBeInTheDocument();
  });

  it('uses the "Today\'s questions" eyebrow (set is mixed-difficulty now)', async () => {
    db = await boot(true);
    render(
      <MemoryRouter>
        <TodaysTriviaCard />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/today's questions/i)).toBeInTheDocument();
  });

  it('finish-setup branch renders when there is no household', async () => {
    db = await boot(true);
    // Force the no-household state and assert SYNCHRONOUSLY, before the mount's
    // loadHousehold() re-populates it from the seeded 0001 row (same approach as
    // the Learn "set up your household" test).
    useHouseholdStore.setState({ household: null, isLoading: false, error: null });
    render(
      <MemoryRouter>
        <TodaysTriviaCard />
      </MemoryRouter>,
    );
    expect(screen.getByText(/finish setting up/i)).toBeInTheDocument();
  });

  it('needs-acceptance branch shows an in-card CTA, not a modal', async () => {
    db = await boot(false); // no learning acceptance row
    render(
      <MemoryRouter>
        <TodaysTriviaCard />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/today's questions/i)).toBeInTheDocument();
    expect(screen.queryByText(/About the Learning feature/i)).not.toBeInTheDocument();
    expect(screen.getByText(/open learn →/i)).toBeInTheDocument();
  });

  it('MUST-1: renders aria-busy (never "0 of 0 · Start") while the learning store has no data', async () => {
    db = await boot(true);
    useLearningStore.setState({ learningState: null, load: async () => {} });
    const { container } = render(
      <MemoryRouter>
        <TodaysTriviaCard />
      </MemoryRouter>,
    );
    await new Promise((r) => setTimeout(r, 0)); // let the bank promise settle
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText(/0 of 0/)).toBeNull();
    expect(screen.queryByText(/Start →/)).toBeNull();
  });

  it('MUST-1: pool exhausted (total 0) shows the calm caught-up branch, not "0 of 0 answered"', async () => {
    db = await boot(true);
    for (const q of FIXTURE_BANK) {
      await db.execute(
        `INSERT INTO learning_answers (question_id, answered_iso_date, chosen_index, was_correct, question_version)
         VALUES (?, '2026-05-01', 0, 1, 1)`,
        [q.id],
      );
    }
    await useLearningStore.getState().load();
    render(
      <MemoryRouter>
        <TodaysTriviaCard />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/caught up/i)).toBeInTheDocument();
    expect(screen.queryByText(/0 of 0/)).toBeNull();
  });

  it('D5: the subtitle follows the difficulty preference', async () => {
    db = await boot(true);
    await db.execute(`UPDATE learning_state SET difficulty_preference = 'Beginner' WHERE id = 1`);
    await useLearningStore.getState().load();
    render(
      <MemoryRouter>
        <TodaysTriviaCard />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Basics questions today.')).toBeInTheDocument();
    expect(screen.queryByText(/mix of Basics/i)).toBeNull();
  });

  it('SHOULD-13: the View link carries a descriptive aria-label', async () => {
    db = await boot(true);
    render(
      <MemoryRouter>
        <TodaysTriviaCard />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole('link', { name: /view today's questions on the learn page/i }),
    ).toBeInTheDocument();
  });
});
