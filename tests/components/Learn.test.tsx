import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useHouseholdStore } from '@/stores/household-store';
import { useLearningStore } from '@/stores/learning-state-store';
import { useAcceptancesStore } from '@/stores/disclosure-acceptances-store';
import { loadTriviaBank } from '@/lib/trivia/load-bank';
import { selectDailyQuestion, localTodayISO } from '@/lib/trivia/daily';
import Learn from '@/pages/Learn';

const sql = (name: string) =>
  readFileSync(resolve(__dirname, `../../src/db/migrations/${name}.sql`), 'utf-8');

async function bootDb() {
  const db = new SqliteAdapter(':memory:');
  await runMigrations(db, [
    { version: '0001_initial', sql: sql('0001_initial') },
    { version: '0017_disclosure_foundations', sql: sql('0017_disclosure_foundations') },
    { version: '0037_learning_state', sql: sql('0037_learning_state') },
  ]);
  setDatabase(db);
  return db;
}

// Insert a learning acceptance row into disclosure_acceptances (the single
// source of truth the gate reads — MF-1/T5), then hydrate the stores. The
// Learn gate only checks a non-null household + the learning acceptance; it
// does NOT read app_wide, so no household disclosure column is touched (those
// columns are dropped in 0041 and this test's migration subset wouldn't have
// them anyway).
async function seedLearningAccepted(db: SqliteAdapter) {
  await db.execute(
    `INSERT INTO disclosure_acceptances (household_id, document_id, version, accepted_at)
     VALUES (1, 'learning', '1.0', '2026-05-28T00:00:00Z')`,
  );
  await useHouseholdStore.getState().load();
  await useAcceptancesStore.getState().load();
  await useLearningStore.getState().load();
}

describe('Learn page', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    // Pin the clock so localTodayISO() is deterministic and the daily selector
    // returns the SAME known question every run (TR-6, Testing MF2 — the page
    // uses the real localTodayISO(), so without this the question rotates with
    // the calendar and ~1 day in 3 the choice-button heuristic matches nothing
    // and the verdict assertion times out). Fake ONLY Date so user-event's and
    // findBy*'s real timers still work.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 4, 28, 12, 0, 0)); // local 2026-05-28
    db = await bootDb();
    useHouseholdStore.setState({ household: null, isLoading: false, error: null });
    useAcceptancesStore.setState({ acceptedVersions: {}, status: 'ready', isLoading: false, error: null });
    useLearningStore.setState({
      learningState: null,
      answeredQuestionIds: [],
      isLoading: false,
      error: null,
    });
  });

  afterEach(async () => {
    // Unmount components before closing the DB so React's async effects
    // (e.g., the "pin today's question" useEffect in Learn.tsx) cannot
    // fire on a closed connection and produce unhandled rejections.
    cleanup();
    // Drain any microtasks queued by the unmounted component's in-flight
    // async effects (e.g., updateLearning() for pinning the daily question)
    // before we close the DB — avoids "connection is not open" unhandled
    // rejections that would fail the pre-commit hook.
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
    // Synchronous: the text is present on the initial render (household is null
    // in state). findByText would race against loadHousehold() resolving from
    // the DB (which seeds a household in 0001), so we check synchronously while
    // the initial null-household state is still in place.
    expect(screen.getByText(/set up your household/i)).toBeInTheDocument();
  });

  it('shows the learning disclosure modal on first visit (household present, unaccepted)', async () => {
    // Household exists (seeded by 0001) but there is NO learning row in
    // disclosure_acceptances, so the table-driven gate is needs-acceptance.
    await useHouseholdStore.getState().load();
    await useAcceptancesStore.getState().load();

    render(
      <MemoryRouter>
        <Learn />
      </MemoryRouter>,
    );
    // The modal title is an <h2> heading. Use findByRole to avoid the multiple-
    // match error that findByText hits when the disclosure body markdown also
    // renders "About the Learning feature" as a <strong> element.
    expect(await screen.findByRole('heading', { name: /About the Learning feature/i })).toBeInTheDocument();
  });

  it('renders today\'s question and locks after answering', async () => {
    await seedLearningAccepted(db);

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Learn />
      </MemoryRouter>,
    );

    // The clock is pinned (beforeEach), so the daily selector returns the SAME
    // known question every run — this prompt match is deterministic.
    const bank = await loadTriviaBank();
    const expected = selectDailyQuestion({
      bank,
      answeredIds: [],
      difficulty: 'Beginner',
      todayISO: '2026-05-28',
      state: { lastShownIsoDate: null, lastShownQuestionId: null },
    });
    if (!expected) throw new Error('no question selected for the pinned date');
    const prompt = await screen.findByText(expected.prompt);
    expect(prompt).toBeInTheDocument();

    // Select a choice button by STRUCTURE, not by guessing its text. Each choice
    // button renders a one-letter badge span ("A") immediately followed by the
    // choice text, so its textContent starts with A/B/C/D (e.g. "AAnnual…").
    // The difficulty-toggle buttons ("Beginner"/"Advanced") also start with
    // A/B, so exclude those exact labels. (TR-6: the old `find` with a `\b`
    // word-boundary regex matched NOTHING — there is no boundary between the
    // badge letter and the run-on choice text — and the `if (firstChoice)`
    // guard then silently skipped the click, so the verdict assertion timed
    // out. This filter deterministically yields the four real choices.)
    const choiceButtons = screen
      .getAllByRole('button')
      .filter((b) => {
        const text = (b.textContent ?? '').trimStart();
        return /^[ABCD]/.test(text) && text !== 'Beginner' && text !== 'Advanced';
      });
    expect(choiceButtons).toHaveLength(4); // four lettered choices, no toggles
    await user.click(choiceButtons[0]);

    // The graded reveal appears with verdict text (this question is real, so the
    // click is never skipped — the assertion is deterministic, not best-effort).
    expect(await screen.findByText(/correct|not quite/i)).toBeInTheDocument();
  });

  // Regression — returning-user state machine. Repro: answer correctly, then
  // reopen /learn the same day (refresh / re-nav / restart). The page rehydrates
  // answeredToday=true (the answered id is in the DB and the question is pinned),
  // but chosenIndex is ephemeral and starts null on the fresh render. The old
  // code rendered the chosenIndex-dependent graded AnsweredView, where
  // `null === answerIndex` is false → it showed "✕ Not quite" + the destructive
  // background EVEN FOR A CORRECT ANSWER. The fix renders the calm done-state
  // instead. The in-session test above only covers click-then-verdict, so it
  // does not catch this.
  it('shows the calm done-state (never a graded "Not quite") when revisiting after a CORRECT answer from a prior session', async () => {
    await seedLearningAccepted(db);

    // Simulate "answered correctly earlier today, then reopened /learn": pin a
    // known question to today and persist a CORRECT prior-session answer for it
    // to the DB (via the repo-backed store, so the page's mount-time load()
    // rehydrates it). chosenIndex is NOT seeded — it is ephemeral React state
    // and starts null on this render, exactly as on a real reload.
    const bank = await loadTriviaBank();
    const q = bank[0];
    if (!q) throw new Error('trivia bank is empty');
    const todayISO = localTodayISO();

    await useLearningStore.getState().update({
      lastShownQuestionId: q.id,
      lastShownIsoDate: todayISO,
      streakCount: 5,
    });
    await useLearningStore.getState().recordAnswer({
      questionId: q.id,
      answeredIsoDate: todayISO,
      chosenIndex: q.answerIndex, // the CORRECT choice
      wasCorrect: true,
      questionVersion: q.version,
    });

    const { container } = render(
      <MemoryRouter>
        <Learn />
      </MemoryRouter>,
    );

    // pinned + answeredToday + chosenIndex===null must resolve to the calm
    // done-state, not the chosenIndex-dependent graded AnsweredView.
    expect(await screen.findByText(/that's today's question/i)).toBeInTheDocument();

    // A correct answer must NEVER be rendered as "Not quite", and the
    // destructive background must NOT appear anywhere on revisit.
    expect(screen.queryByText(/not quite/i)).not.toBeInTheDocument();
    const hasDestructiveBg = Array.from(container.querySelectorAll('*')).some(
      (el) => typeof el.className === 'string' && el.className.includes('bg-destructive'),
    );
    expect(hasDestructiveBg).toBe(false);
  });

  it('has no gamification UI (no points/confetti/badge bling copy)', async () => {
    await seedLearningAccepted(db); // app_wide column + learning acceptance row (MF-1)

    render(
      <MemoryRouter>
        <Learn />
      </MemoryRouter>,
    );
    await screen.findByText(/learn/i);
    expect(screen.queryByText(/points|confetti|congratulations|🎉|streak lost|don't lose/i)).toBeNull();
    // The streak is a quiet number, present as "<n>-day streak".
    expect(screen.getByText(/-day streak/i)).toBeInTheDocument();
  });

  it('renders the Advanced badge with dark-mode-legible classes', async () => {
    await seedLearningAccepted(db);
    // Force an Advanced question by setting the preference + a bank that has one.
    await useLearningStore.getState().update({ difficultyPreference: 'Advanced' });

    render(
      <MemoryRouter>
        <Learn />
      </MemoryRouter>,
    );
    const badge = await screen.findByText('Advanced', { selector: 'span' });
    // dark: variant gives lighter slate text on transparent fill (spec §10.3).
    expect(badge.className).toMatch(/dark:text-slate-300/);
    expect(badge.className).toMatch(/dark:bg-transparent/);
  });

  it("swaps today's question to the new tier when difficulty changes before answering", async () => {
    await seedLearningAccepted(db);
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Learn />
      </MemoryRouter>,
    );

    // Today's question starts at the Beginner tier (the pinned date selects one).
    expect(await screen.findByText('Beginner', { selector: 'span' })).toBeInTheDocument();

    // Flip to Advanced — unanswered, so today's question swaps to an Advanced one.
    await user.click(screen.getByRole('button', { name: 'Advanced' }));
    expect(await screen.findByText('Advanced', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByText('Beginner', { selector: 'span' })).toBeNull();
  });

  it("locks today's question once answered — flipping difficulty does not swap it", async () => {
    await seedLearningAccepted(db);
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Learn />
      </MemoryRouter>,
    );

    // Answer today's (Beginner) question.
    await screen.findByText('Beginner', { selector: 'span' });
    const choices = screen.getAllByRole('button').filter((b) => {
      const t = (b.textContent ?? '').trimStart();
      return /^[ABCD]/.test(t) && t !== 'Beginner' && t !== 'Advanced';
    });
    await user.click(choices[0]);
    await screen.findByText(/correct|not quite/i); // graded reveal == answered this session

    // Flip to Advanced: the PREFERENCE updates, but today's question is LOCKED.
    await user.click(screen.getByRole('button', { name: 'Advanced' }));
    expect(screen.getByRole('button', { name: 'Advanced' })).toHaveAttribute('aria-pressed', 'true');
    // The answered question's badge is still Beginner — it did NOT swap tiers.
    expect(screen.getByText('Beginner', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByText('Advanced', { selector: 'span' })).toBeNull();
  });
});
