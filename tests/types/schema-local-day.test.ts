import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ContributionSchema } from '@/types/schema';
import { ContributionSource } from '@/types/enums';

/**
 * v1.7.0 R4 smoke regression: `pastOrTodayDate` (contribution date, DOB,
 * purchase / grant dates) capped a date at the UTC day. The app's writers
 * stamp the LOCAL day, so east of UTC a morning entry dated today was refused
 * as "in the future", and west of UTC an evening entry dated TOMORROW passed.
 * The cap is now the local day. (schema.test.ts reads the real clock under
 * the frozen test-clock allowlist; these arms pin it instead.)
 */
const contribution = (date: string) => ContributionSchema.safeParse({
  accountId: 1, personId: null, date, amount: 500, source: ContributionSource.PAYCHECK,
});

describe('pastOrTodayDate caps at the LOCAL day', () => {
  const ORIGINAL_TZ = process.env.TZ;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  it('New York, 23:33 EDT (03:33 UTC the next day): the local 24th passes, the 25th is the future', () => {
    process.env.TZ = 'America/New_York';
    vi.setSystemTime(new Date('2026-09-25T03:33:00Z'));
    expect(contribution('2026-09-24').success).toBe(true);
    const tomorrow = contribution('2026-09-25');
    expect(tomorrow.success).toBe(false);
    expect(tomorrow.error?.issues[0].message).toBe('Date cannot be in the future');
  });

  it('Pacific/Kiritimati, 02:00 (12:00 UTC the previous day): the local 25th passes, the 26th is the future', () => {
    process.env.TZ = 'Pacific/Kiritimati';
    vi.setSystemTime(new Date('2026-09-24T12:00:00Z'));
    expect(contribution('2026-09-25').success).toBe(true);
    expect(contribution('2026-09-26').success).toBe(false);
  });
});
