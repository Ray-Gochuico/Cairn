import { describe, it, expect } from 'vitest';
import {
  reimbursementMarker,
  reimbursementState,
  reimbursementStatusLine,
} from '@/lib/reimbursement-status';

describe('reimbursement status — one reading for the editor line and the list marker (v1.7.1 R10)', () => {
  it('the marker: Reimbursed, Awaiting, or nothing (CR-R10-A / CR-R10-B)', () => {
    expect(reimbursementMarker({ reimbursable: true, reimbursedAt: '2026-06-25' })).toBe('Reimbursed');
    expect(reimbursementMarker({ reimbursable: true, reimbursedAt: null })).toBe('Awaiting');
    expect(reimbursementMarker({ reimbursable: false, reimbursedAt: null })).toBeNull();
    // A row saved before R10 with Reimbursable off but a stale date: no state,
    // exactly as the editor line and every spending consumer read it.
    expect(reimbursementMarker({ reimbursable: false, reimbursedAt: '2026-06-25' })).toBeNull();
  });

  it('the marker and the editor line never disagree — every shape of the three columns', () => {
    for (const reimbursable of [true, false]) {
      for (const reimbursedAt of [null, '2026-06-25']) {
        for (const reimbursedAmount of [null, 0, 132.4]) {
          const t = { reimbursable, reimbursedAt, reimbursedAmount };
          const line = reimbursementStatusLine(t);
          const marker = reimbursementMarker(t);
          const state = reimbursementState(t);
          expect(marker === null).toBe(line === null);
          expect(state === null).toBe(line === null);
          expect(marker === 'Awaiting').toBe(line === 'Awaiting reimbursement.');
          expect(state === 'awaiting').toBe(line === 'Awaiting reimbursement.');
          expect(marker === 'Reimbursed').toBe(line?.startsWith('Reimbursed ') === true);
          expect(state === 'reimbursed').toBe(line?.startsWith('Reimbursed ') === true);
        }
      }
    }
  });
});
