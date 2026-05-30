import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useLearningStore } from '@/stores/learning-state-store';
import { LearningSection } from '@/components/settings/LearningSection';

const sql = (name: string) =>
  readFileSync(resolve(__dirname, `../../src/db/migrations/${name}.sql`), 'utf-8');

describe('LearningSection', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: sql('0001_initial') },
      { version: '0037_learning_state', sql: sql('0037_learning_state') },
    ]);
    setDatabase(db);
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

  it('renders the three difficulty options with Beginner selected by default', async () => {
    render(
      <MemoryRouter>
        <LearningSection />
      </MemoryRouter>,
    );
    const beginner = await screen.findByRole('button', { name: 'Beginner' });
    expect(beginner).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Advanced' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mixed' })).toBeInTheDocument();
  });

  it('persists a difficulty change', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <LearningSection />
      </MemoryRouter>,
    );
    const btn = await screen.findByRole('button', { name: 'Advanced' });
    await screen.findByRole('button', { name: 'Beginner', hidden: false });
    // Wait for load() to resolve so the buttons are enabled before clicking
    const { waitFor } = await import('@testing-library/react');
    await waitFor(() => expect(btn).toBeEnabled());
    await user.click(btn);
    await screen.findByRole('button', { name: 'Advanced' });
    expect(useLearningStore.getState().learningState?.difficultyPreference).toBe('Advanced');
  });
});
