import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useHouseholdStore } from '@/stores/household-store';
import { useLearningStore } from '@/stores/learning-state-store';
import { useAcceptancesStore } from '@/stores/disclosure-acceptances-store';
import Learn from '@/pages/Learn';

// Loose live-bank smoke (panel Testing H3): NO load-bank mock here — Learn renders
// against the REAL reviewed bank-v1.json. We only assert it renders without
// throwing and reaches a stable state, so live-content regressions are caught
// without the structural fixture suite (Learn.test.tsx) going flaky as content
// evolves.

const sql = (name: string) =>
  readFileSync(resolve(__dirname, `../../src/db/migrations/${name}.sql`), 'utf-8');

describe('Learn page — live bank smoke', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 4, 28, 12, 0, 0));
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: sql('0001_initial') },
      { version: '0017_disclosure_foundations', sql: sql('0017_disclosure_foundations') },
      { version: '0037_learning_state', sql: sql('0037_learning_state') },
    { version: '0048_learning_preference_default', sql: sql('0048_learning_preference_default') },
    ]);
    setDatabase(db);
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

  it('renders the live 4-set without throwing for a seeded, accepted user', async () => {
    await db.execute(
      `INSERT INTO disclosure_acceptances (household_id, document_id, version, accepted_at)
       VALUES (1, 'learning', '1.0', '2026-05-28T00:00:00Z')`,
    );
    await useHouseholdStore.getState().load();
    await useAcceptancesStore.getState().load();
    await useLearningStore.getState().load();

    expect(() =>
      render(
        <MemoryRouter>
          <Learn />
        </MemoryRouter>,
      ),
    ).not.toThrow();
    // Reaches a stable rendered state (the Basics group from the real bank).
    expect(await screen.findByText(/^Basics$/)).toBeInTheDocument();
  });
});
