import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The registry pulls the Section-4 importer → PDF pipeline; mock before
// imports, verbatim from SectionLayout.test.tsx.
vi.mock('@/pdf/extract', () => ({
  extractTextItems: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/pdf/parse-statement', () => ({
  parseStatement: vi.fn().mockReturnValue({
    issuer: 'GENERIC',
    transactions: [],
  }),
}));
vi.mock('@/lib/statements-archive', () => ({
  archiveStatementPdf: vi.fn().mockResolvedValue(null),
  resolveArchivePath: vi.fn(),
}));

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import FlowShell from '@/pages/setup/flow/FlowShell';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { defaultProgressV2, saveSetupProgress } from '@/lib/setup-progress';
import { useHouseholdStore } from '@/stores/household-store';

/**
 * Smoke finding D1 (shell rung): the ONLY suite that runs the 1b married
 * branch through the real shell + REAL stores + REAL in-memory DB and then
 * reads the PERSISTED household row — every other FlowShell test stubs the
 * household store, which is exactly how the original suite missed the smoke's
 * report. NO store priming here: the shell's own hydration block loads the
 * real stores from the migrated DB.
 */

describe('FlowShell 1b married branch against the REAL DB (smoke D1)', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    localStorage.clear();
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    // Reset the singleton store so a previous test's state can't leak.
    useHouseholdStore.setState({ household: null, isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('Yes + Jointly + Next persists MFJ to the household ROW (not just the store echo)', async () => {
    const user = userEvent.setup();
    saveSetupProgress({
      ...defaultProgressV2(),
      statuses: { about_you: 'completed' },
      drafts: { you: { name: 'Alex Rivera', dateOfBirth: '1990-05-01' } },
      cursor: { stepId: 'marital_filing' },
    });
    render(
      <MemoryRouter>
        <FlowShell onSwitchView={vi.fn()} />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: 'About you — step 2 of 5' });
    await user.click(screen.getByRole('radio', { name: 'Yes' }));
    await user.click(screen.getByRole('radio', { name: 'Jointly' }));
    await user.type(screen.getByLabelText("Your partner's name"), 'Sam Rivera');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: 'About you — step 3 of 5' });
    const rows = await db.select<{ filing_status: string }>(
      'SELECT filing_status FROM household WHERE id = 1',
    );
    expect(rows[0].filing_status).toBe('MFJ');
  });
});
