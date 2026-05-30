import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
import { TodaysTriviaCard } from '@/components/dashboard/TodaysTriviaCard';

const sql = (name: string) =>
  readFileSync(resolve(__dirname, `../../src/db/migrations/${name}.sql`), 'utf-8');

describe('TodaysTriviaCard', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: sql('0001_initial') },
      { version: '0017_disclosure_foundations', sql: sql('0017_disclosure_foundations') },
      { version: '0037_learning_state', sql: sql('0037_learning_state') },
    ]);
    setDatabase(db);
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
    await db.close();
  });

  it('renders the eyebrow and a prompt before answering (gated open)', async () => {
    // A learning row in disclosure_acceptances (the gate's single source under
    // MF-1/T5) opens the gate; no household disclosure column is touched.
    await db.execute(
      `INSERT INTO disclosure_acceptances (household_id, document_id, version, accepted_at)
       VALUES (1, 'learning', '1.0', '2026-05-28T00:00:00Z')`,
    );
    await useHouseholdStore.getState().load();
    await useAcceptancesStore.getState().load();
    await useLearningStore.getState().load();

    render(
      <MemoryRouter>
        <TodaysTriviaCard />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/today's question/i)).toBeInTheDocument();
    expect(screen.getByText(/Answer →/i)).toBeInTheDocument();
  });

  it('shows a CTA to /learn when the learning disclosure is unaccepted', async () => {
    // No learning row in disclosure_acceptances → gate is needs-acceptance.
    await useHouseholdStore.getState().load();
    await useAcceptancesStore.getState().load();
    await useLearningStore.getState().load();

    render(
      <MemoryRouter>
        <TodaysTriviaCard />
      </MemoryRouter>,
    );
    // Does NOT render a modal; renders an in-card CTA linking to /learn.
    expect(await screen.findByText(/today's question/i)).toBeInTheDocument();
    expect(screen.queryByText(/About the Learning feature/i)).not.toBeInTheDocument();
  });
});
