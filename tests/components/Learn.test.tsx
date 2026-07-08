import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useHouseholdStore } from '@/stores/household-store';
import { useLearningStore } from '@/stores/learning-state-store';
import { useAcceptancesStore } from '@/stores/disclosure-acceptances-store';
import { QuestionFormat, Topic } from '@/types/enums';
import type { TriviaQuestion } from '@/lib/trivia/bank-schema';
import Learn from '@/pages/Learn';

const sql = (name: string) =>
  readFileSync(resolve(__dirname, `../../src/db/migrations/${name}.sql`), 'utf-8');

// Fixture isolation (panel Testing H3): a controlled REVIEWED bank — ≥4 topics ×
// 2 tiers — so the 2+2 / distinct-topic / two-group assertions are deterministic
// regardless of how the live 60 evolve. (A loose live-bank render smoke lives in
// Learn.smoke.test.tsx so live-content regressions are still caught without
// making these structural tests flaky.)
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
  qt('beg-savings', 'Beginner', Topic.SAVINGS),
  qt('adv-invest', 'Advanced', Topic.INVESTMENTS),
  qt('adv-tax', 'Advanced', Topic.TAXES),
  qt('adv-retire', 'Advanced', Topic.RETIREMENT),
];

vi.mock('@/lib/trivia/load-bank', async () => {
  const actual = await vi.importActual<typeof import('@/lib/trivia/load-bank')>(
    '@/lib/trivia/load-bank',
  );
  return {
    ...actual,
    loadTriviaBank: vi.fn(async () => FIXTURE_BANK),
  };
});

async function bootDb() {
  const db = new SqliteAdapter(':memory:');
  await runMigrations(db, [
    { version: '0001_initial', sql: sql('0001_initial') },
    { version: '0017_disclosure_foundations', sql: sql('0017_disclosure_foundations') },
    { version: '0037_learning_state', sql: sql('0037_learning_state') },
    { version: '0048_learning_preference_default', sql: sql('0048_learning_preference_default') },
  ]);
  setDatabase(db);
  return db;
}

async function seedLearningAccepted(db: SqliteAdapter) {
  await db.execute(
    `INSERT INTO disclosure_acceptances (household_id, document_id, version, accepted_at)
     VALUES (1, 'learning', '1.0', '2026-05-28T00:00:00Z')`,
  );
  await useHouseholdStore.getState().load();
  await useAcceptancesStore.getState().load();
  await useLearningStore.getState().load();
}

const promptCard = (n: number): HTMLElement => {
  const prompt = screen.getAllByText(/^Prompt for /)[n];
  return prompt.closest('[data-question-card]') as HTMLElement;
};
const answerCard = async (user: ReturnType<typeof userEvent.setup>, n: number) => {
  const card = promptCard(n);
  const btns = within(card)
    .getAllByRole('button')
    .filter((b) => /-c\d$/.test(b.textContent ?? ''));
  await user.click(btns[0]);
};

describe('Learn page (4-set)', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 4, 28, 12, 0, 0)); // local 2026-05-28
    db = await bootDb();
    useHouseholdStore.setState({ household: null, isLoading: false, error: null });
    useAcceptancesStore.setState({
      acceptedVersions: {},
      status: 'ready',
      isLoading: false,
      error: null,
    });
    useLearningStore.setState({
      learningState: null,
      answeredQuestionIds: [],
      answeredKeysByDay: { priorDays: [], today: [] },
      isLoading: false,
      error: null,
    });
  });

  afterEach(async () => {
    cleanup();
    await new Promise((r) => setTimeout(r, 0));
    await db.close();
    vi.useRealTimers();
  });

  it('prompts for setup when there is no household', () => {
    render(
      <MemoryRouter>
        <Learn />
      </MemoryRouter>,
    );
    expect(screen.getByText(/set up your household/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /set up household/i })).toHaveAttribute('href', '/inputs/household');
  });

  it('shows the learning disclosure modal on first visit (household present, unaccepted)', async () => {
    await useHouseholdStore.getState().load();
    await useAcceptancesStore.getState().load();
    render(
      <MemoryRouter>
        <Learn />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole('heading', { name: /About the Learning feature/i }),
    ).toBeInTheDocument();
  });

  it('renders two labeled groups (Basics / Going deeper) with the 4 cards', async () => {
    await seedLearningAccepted(db);
    render(
      <MemoryRouter>
        <Learn />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/^Basics$/)).toBeInTheDocument();
    expect(screen.getByText(/going deeper/i)).toBeInTheDocument();
    const prompts = screen.getAllByText(/^Prompt for /);
    expect(prompts).toHaveLength(4);
  });

  it('shows a per-question difficulty badge on each card (badge kept)', async () => {
    await seedLearningAccepted(db);
    render(
      <MemoryRouter>
        <Learn />
      </MemoryRouter>,
    );
    await screen.findByText(/^Basics$/);
    expect(screen.getAllByText('Beginner', { selector: 'span' })).toHaveLength(2);
    expect(screen.getAllByText('Advanced', { selector: 'span' })).toHaveLength(2);
  });

  it('the difficulty toggle is GONE (no Mixed button, no Difficulty heading)', async () => {
    await seedLearningAccepted(db);
    render(
      <MemoryRouter>
        <Learn />
      </MemoryRouter>,
    );
    await screen.findByText(/^Basics$/);
    expect(screen.queryByRole('button', { name: 'Mixed' })).toBeNull();
    expect(screen.queryByText(/^Difficulty$/)).toBeNull();
  });

  it('answering one card reveals ITS grade inline without revealing the others', async () => {
    await seedLearningAccepted(db);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <MemoryRouter>
        <Learn />
      </MemoryRouter>,
    );
    await screen.findByText(/^Basics$/);
    await answerCard(user, 0);
    await waitFor(() => expect(screen.getAllByText(/correct|not quite/i)).toHaveLength(1));
  });

  it('moves the streak once on the first answer; a second same-session answer does not double-count', async () => {
    await seedLearningAccepted(db);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <MemoryRouter>
        <Learn />
      </MemoryRouter>,
    );
    await screen.findByText(/^Basics$/);

    await answerCard(user, 0);
    await waitFor(() => expect(useLearningStore.getState().learningState?.streakCount).toBe(1));

    await answerCard(user, 1);
    await waitFor(() =>
      expect(screen.getAllByText(/correct|not quite/i).length).toBeGreaterThan(1),
    );
    // Second same-day answer is the idempotent no-op — streak stays 1.
    expect(useLearningStore.getState().learningState?.streakCount).toBe(1);
  });

  it('has no gamification UI and shows the quiet streak', async () => {
    await seedLearningAccepted(db);
    render(
      <MemoryRouter>
        <Learn />
      </MemoryRouter>,
    );
    await screen.findByText(/^Basics$/);
    expect(
      screen.queryByText(/points|confetti|congratulations|🎉|streak lost|don't lose/i),
    ).toBeNull();
    expect(screen.getByText(/-day streak/i)).toBeInTheDocument();
  });

  it('renders the Advanced badge with dark-mode-legible classes', async () => {
    await seedLearningAccepted(db);
    render(
      <MemoryRouter>
        <Learn />
      </MemoryRouter>,
    );
    const badge = (await screen.findAllByText('Advanced', { selector: 'span' }))[0];
    expect(badge.className).toMatch(/dark:text-slate-300/);
    expect(badge.className).toMatch(/dark:bg-transparent/);
  });
});
