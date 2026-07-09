import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, act, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useHouseholdStore } from '@/stores/household-store';
import { useLearningStore } from '@/stores/learning-state-store';
import { useAcceptancesStore } from '@/stores/disclosure-acceptances-store';
import { loadTriviaBank } from '@/lib/trivia/load-bank';
import { selectDailySet } from '@/lib/trivia/daily';
import { answeredKey } from '@/lib/trivia/answered-key';
import { QuestionFormat, Topic } from '@/types/enums';
import type { TriviaQuestion } from '@/lib/trivia/bank-schema';
import Learn from '@/pages/Learn';

const sql = (name: string) =>
  readFileSync(resolve(__dirname, `../../src/db/migrations/${name}.sql`), 'utf-8');

// Fixture isolation (panel Testing H3): a controlled REVIEWED bank — 4 Beginner
// + 4 Advanced across 8 topics — so the stepper / preference / anchor
// assertions are deterministic regardless of how the live 600 evolve. (A loose
// live-bank render smoke lives in Learn.smoke.test.tsx so live-content
// regressions are still caught without making these structural tests flaky.)
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
  qt('beg-spend', 'Beginner', Topic.SPENDING),
  qt('adv-invest', 'Advanced', Topic.INVESTMENTS),
  qt('adv-tax', 'Advanced', Topic.TAXES),
  qt('adv-retire', 'Advanced', Topic.RETIREMENT),
  qt('adv-insure', 'Advanced', Topic.INSURANCE),
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

// The store's REAL load — MUST-1 tests stub it out; every test starts restored.
const realLearningLoad = useLearningStore.getState().load;

// What the page must show for a preference on the pinned test day (2026-05-28).
const expectedSet = (
  preference: 'Beginner' | 'Advanced' | 'Mixed' = 'Mixed',
  answeredTodayIds: string[] = [],
) =>
  selectDailySet({
    bank: FIXTURE_BANK,
    answeredIds: [],
    answeredTodayIds,
    todayISO: '2026-05-28',
    preference,
  });
const chooseAnswer = async (user: ReturnType<typeof userEvent.setup>, letterIndex: number) => {
  const btns = screen.getAllByRole('button').filter((b) => /-c\d$/.test(b.textContent ?? ''));
  await user.click(btns[letterIndex]);
};
const nextBtn = () => screen.getByRole('button', { name: /next question/i });
const backBtn = () => screen.getByRole('button', { name: /previous question/i });

describe('Learn page (one-at-a-time stepper, Wave 8)', () => {
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
      answeredKeysByDay: { priorDays: [], today: [], todayDetails: [] },
      answeredStats: null,
      isLoading: false,
      error: null,
      load: realLearningLoad,
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

  it('MUST-1: while the learning store is loading, shows an aria-busy placeholder — never the exhausted state', async () => {
    await useHouseholdStore.getState().load();
    await useAcceptancesStore.getState().load();
    await db.execute(
      `INSERT INTO disclosure_acceptances (household_id, document_id, version, accepted_at)
       VALUES (1, 'learning', '1.0', '2026-05-28T00:00:00Z')`,
    );
    await useAcceptancesStore.getState().load();
    // Freeze the store pre-load: learningState null, load stubbed to hang.
    useLearningStore.setState({ learningState: null, load: async () => {} });
    render(<MemoryRouter><Learn /></MemoryRouter>);
    expect(await screen.findByText(/loading/i)).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText(/answered every question/i)).toBeNull();
  });

  it('MUST-1: a failed learning-store load renders the calm error card, not the exhausted state', async () => {
    await seedLearningAccepted(db);
    useLearningStore.setState({ learningState: null, error: 'db exploded', load: async () => {} });
    render(<MemoryRouter><Learn /></MemoryRouter>);
    expect(await screen.findByText(/couldn't load today's questions/i)).toBeInTheDocument();
    expect(screen.queryByText(/answered every question/i)).toBeNull();
  });

  it('shows a calm inline notice — quiz intact — when the answer write failed (W10 chip)', async () => {
    await seedLearningAccepted(db);
    render(<MemoryRouter><Learn /></MemoryRouter>);
    // Wait for the quiz to hydrate (learningState non-null), then simulate a
    // post-answer write failure.
    await screen.findByText('Question 1 of 4');
    act(() => {
      useLearningStore.setState({ error: 'disk full' } as never);
    });
    expect(screen.getByText(/couldn.t save that answer/i)).toBeInTheDocument();
    // The quiz did NOT collapse into the load-failure card:
    expect(screen.queryByText(/couldn.t load today.s questions/i)).not.toBeInTheDocument();
  });

  it("MUST-4: a rejected bank load renders the calm error card (the page's SEC-1 catch arm)", async () => {
    vi.mocked(loadTriviaBank).mockRejectedValueOnce(new Error('malformed bank'));
    await seedLearningAccepted(db);
    render(<MemoryRouter><Learn /></MemoryRouter>);
    expect(await screen.findByText(/couldn't load today's questions/i)).toBeInTheDocument();
  });

  it('one-at-a-time: renders ONE question with the stepper count; Back disabled at the start', async () => {
    await seedLearningAccepted(db);
    render(<MemoryRouter><Learn /></MemoryRouter>);
    expect(await screen.findByText('Question 1 of 4')).toBeInTheDocument();
    expect(screen.getAllByText(/^Prompt for /)).toHaveLength(1);
    expect(screen.getByText(expectedSet()[0].prompt)).toBeInTheDocument();
    expect(backBtn()).toBeDisabled();
  });

  it('Next/Back walk the set; Next disabled on the last question; focus lands on the prompt heading', async () => {
    await seedLearningAccepted(db);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<MemoryRouter><Learn /></MemoryRouter>);
    await screen.findByText('Question 1 of 4');
    const set = expectedSet();
    await user.click(nextBtn());
    expect(screen.getByText('Question 2 of 4')).toBeInTheDocument();
    expect(screen.getByText(set[1].prompt)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: set[1].prompt })).toHaveFocus();
    await user.click(backBtn());
    expect(screen.getByText('Question 1 of 4')).toBeInTheDocument();
    await user.click(nextBtn());
    await user.click(nextBtn());
    await user.click(nextBtn());
    expect(screen.getByText('Question 4 of 4')).toBeInTheDocument();
    expect(nextBtn()).toBeDisabled();
  });

  it('answering announces + focuses the graded reveal (role=status) and shows the citation line', async () => {
    await seedLearningAccepted(db);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<MemoryRouter><Learn /></MemoryRouter>);
    await screen.findByText('Question 1 of 4');
    await chooseAnswer(user, 0); // answerIndex 0 → correct
    const reveal = await screen.findByRole('status');
    await waitFor(() => expect(reveal).toHaveFocus());
    expect(within(reveal).getByText(/✓ Correct/)).toBeInTheDocument();
    // SHOULD-8e: source + question-version citation.
    expect(within(reveal).getByText(/Source: IRS Pub 17 · question v1/)).toBeInTheDocument();
    // SHOULD-13: sr-only clarifier on the correct row.
    expect(within(reveal).getByText('Correct answer')).toBeInTheDocument();
  });

  it('MUST-4b: a WRONG answer says "Not quite" and persists was_correct=0 with the chosen index', async () => {
    await seedLearningAccepted(db);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<MemoryRouter><Learn /></MemoryRouter>);
    await screen.findByText('Question 1 of 4');
    await chooseAnswer(user, 2); // answerIndex is 0 → wrong
    expect(await screen.findByText(/Not quite — the answer is A/)).toBeInTheDocument();
    expect(screen.getByText('Your answer')).toBeInTheDocument(); // sr-only on the chosen row
    const rows = await db.select<{ was_correct: number; chosen_index: number }>(
      'SELECT was_correct, chosen_index FROM learning_answers',
    );
    expect(rows).toEqual([{ was_correct: 0, chosen_index: 2 }]);
  });

  it('stepping BACK to an answered question re-renders the FULL graded reveal (not a stub)', async () => {
    await seedLearningAccepted(db);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<MemoryRouter><Learn /></MemoryRouter>);
    await screen.findByText('Question 1 of 4');
    await chooseAnswer(user, 1);
    await screen.findByRole('status');
    await user.click(nextBtn());
    await user.click(backBtn());
    const reveal = await screen.findByRole('status');
    expect(within(reveal).getByText(/Explanation for /)).toBeInTheDocument();
    expect(screen.queryByText(/^✓ Answered today$/)).toBeNull();
  });

  it("a LATER SAME-DAY visit rehydrates the reveal from the persisted chosen_index (explanations aren't one-shot)", async () => {
    const set = expectedSet();
    await seedLearningAccepted(db);
    // Simulate a PRIOR session today: answer row in the DB, nothing in React state.
    await db.execute(
      `INSERT INTO learning_answers (question_id, answered_iso_date, chosen_index, was_correct, question_version)
       VALUES (?, '2026-05-28', 3, 0, 1)`,
      [set[0].id],
    );
    await useLearningStore.getState().load();
    render(<MemoryRouter><Learn /></MemoryRouter>);
    // Lands on the first UNANSWERED (question 2)…
    expect(await screen.findByText('Question 2 of 4')).toBeInTheDocument();
    // …and Back shows question 1 fully graded with the persisted (wrong) pick D.
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(backBtn());
    const reveal = await screen.findByRole('status');
    expect(within(reveal).getByText(/Not quite — the answer is A/)).toBeInTheDocument();
  });

  it('answering every question shows the success banner and safe-streak copy', async () => {
    await seedLearningAccepted(db);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<MemoryRouter><Learn /></MemoryRouter>);
    await screen.findByText('Question 1 of 4');
    for (let i = 0; i < 4; i++) {
      await chooseAnswer(user, 0);
      await screen.findByRole('status');
      if (i < 3) await user.click(nextBtn());
    }
    expect(await screen.findByText(/That's today's set/)).toBeInTheDocument();
    expect(screen.getByText(/streak is\s*safe/i)).toBeInTheDocument();
  });

  it('moves the streak once on the first answer; a second same-session answer does not double-count', async () => {
    await seedLearningAccepted(db);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<MemoryRouter><Learn /></MemoryRouter>);
    await screen.findByText('Question 1 of 4');

    await chooseAnswer(user, 0);
    await waitFor(() => expect(useLearningStore.getState().learningState?.streakCount).toBe(1));

    await user.click(nextBtn());
    await chooseAnswer(user, 0);
    await screen.findByRole('status');
    // Second same-day answer is the idempotent no-op — streak stays 1.
    await waitFor(() =>
      expect(useLearningStore.getState().answeredKeysByDay.today).toHaveLength(2),
    );
    expect(useLearningStore.getState().learningState?.streakCount).toBe(1);
  });

  it('preference toggle: Mix pressed by default; choosing Basics persists and serves 4 Beginners', async () => {
    await seedLearningAccepted(db);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<MemoryRouter><Learn /></MemoryRouter>);
    await screen.findByText('Question 1 of 4');
    expect(screen.getByRole('button', { name: 'Mix' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Basics' }));
    await waitFor(() =>
      expect(useLearningStore.getState().learningState?.difficultyPreference).toBe('Beginner'),
    );
    expect(await screen.findByText(expectedSet('Beginner')[0].prompt)).toBeInTheDocument();
    expect(screen.getAllByText('Beginner', { selector: 'span' }).length).toBeGreaterThan(0);
  });

  it('MID-DAY TOGGLE: an answered question stays in the set and stays graded', async () => {
    await seedLearningAccepted(db);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<MemoryRouter><Learn /></MemoryRouter>);
    await screen.findByText('Question 1 of 4');
    const answered = expectedSet()[0];
    await chooseAnswer(user, 0);
    await screen.findByRole('status');
    await user.click(screen.getByRole('button', { name: 'Going deeper' }));
    await waitFor(() => expect(screen.getByText(/Question \d of 4/)).toBeInTheDocument());
    const key = answeredKey(answered.id, answered.version);
    const newSet = expectedSet('Advanced', [key]);
    expect(newSet.map((x) => x.id)).toContain(answered.id); // selector anchors it (pinned in T2; re-asserted through the page here)
    // Position tracks question ID: the answered card survives the re-derive,
    // so the user stays parked on it and the reveal is intact.
    expect(screen.getByText(answered.prompt)).toBeInTheDocument();
    expect(await screen.findByRole('status')).toBeInTheDocument();
  });

  it('exhausted PREFERRED tier: honest copy pointing at the still-rendered toggle', async () => {
    await seedLearningAccepted(db);
    // All Beginners answered on prior days; preference Basics.
    for (const q of FIXTURE_BANK.filter((x) => x.difficulty === 'Beginner')) {
      await db.execute(
        `INSERT INTO learning_answers (question_id, answered_iso_date, chosen_index, was_correct, question_version)
         VALUES (?, '2026-05-01', 0, 1, 1)`,
        [q.id],
      );
    }
    await db.execute(`UPDATE learning_state SET difficulty_preference = 'Beginner' WHERE id = 1`);
    await useLearningStore.getState().load();
    render(<MemoryRouter><Learn /></MemoryRouter>);
    expect(await screen.findByText(/answered every Basics question/i)).toBeInTheDocument();
    expect(screen.getByText(/switch the difficulty above/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Going deeper' })).toBeInTheDocument();
  });

  it('exhausted WHOLE pool: update-oriented copy (no "come back tomorrow" lie)', async () => {
    await seedLearningAccepted(db);
    for (const q of FIXTURE_BANK) {
      await db.execute(
        `INSERT INTO learning_answers (question_id, answered_iso_date, chosen_index, was_correct, question_version)
         VALUES (?, '2026-05-01', 0, 1, 1)`,
        [q.id],
      );
    }
    await useLearningStore.getState().load();
    render(<MemoryRouter><Learn /></MemoryRouter>);
    expect(await screen.findByText(/answered every question available/i)).toBeInTheDocument();
    expect(screen.getByText(/ship with app updates/i)).toBeInTheDocument();
    expect(screen.queryByText(/come back tomorrow/i)).toBeNull();
  });

  it('streak tooltip no longer promises grace days', async () => {
    await seedLearningAccepted(db);
    render(<MemoryRouter><Learn /></MemoryRouter>);
    await screen.findByText('Question 1 of 4');
    const chip = screen.getByText(/-day streak/i).closest('span[title]') as HTMLElement;
    expect(chip.getAttribute('title')).toMatch(/miss a day/i);
    expect(chip.getAttribute('title')).not.toMatch(/miss a few/i);
  });

  it('shows the all-time progress line once at least one answer exists', async () => {
    await seedLearningAccepted(db);
    await db.execute(
      `INSERT INTO learning_answers (question_id, answered_iso_date, chosen_index, was_correct, question_version)
       VALUES ('old-1', '2026-05-01', 0, 1, 1), ('old-2', '2026-05-02', 1, 0, 1)`,
    );
    await useLearningStore.getState().load();
    render(<MemoryRouter><Learn /></MemoryRouter>);
    expect(await screen.findByText('2 answered · 50% correct')).toBeInTheDocument();
  });

  it('glossary link uses the display term, not the raw uppercase key', async () => {
    // Give the day's first question a glossaryTerm whose display casing differs.
    const set = expectedSet();
    const withTerm = FIXTURE_BANK.map((q) =>
      q.id === set[0].id ? { ...q, glossaryTerm: 'ROTH IRA' } : q,
    );
    vi.mocked(loadTriviaBank).mockResolvedValueOnce(withTerm);
    await seedLearningAccepted(db);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<MemoryRouter><Learn /></MemoryRouter>);
    await screen.findByText('Question 1 of 4');
    await chooseAnswer(user, 0);
    expect(await screen.findByText(/Read more about Roth IRA/)).toBeInTheDocument();
    expect(screen.queryByText(/Read more about ROTH IRA/)).toBeNull();
  });

  it('has no gamification UI and shows the quiet streak', async () => {
    await seedLearningAccepted(db);
    render(
      <MemoryRouter>
        <Learn />
      </MemoryRouter>,
    );
    await screen.findByText('Question 1 of 4');
    expect(
      screen.queryByText(/points|confetti|congratulations|🎉|streak lost|don't lose/i),
    ).toBeNull();
    expect(screen.getByText(/-day streak/i)).toBeInTheDocument();
  });

  it('renders the Advanced badge with dark-mode-legible classes', async () => {
    await seedLearningAccepted(db);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <MemoryRouter>
        <Learn />
      </MemoryRouter>,
    );
    await screen.findByText('Question 1 of 4');
    // Canonical order is Beginner-first — step to the first Advanced card.
    await user.click(nextBtn());
    await user.click(nextBtn());
    const badge = (await screen.findAllByText('Advanced', { selector: 'span' }))[0];
    expect(badge.className).toMatch(/dark:text-slate-300/);
    expect(badge.className).toMatch(/dark:bg-transparent/);
  });
});
