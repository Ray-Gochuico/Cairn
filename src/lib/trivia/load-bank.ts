import { TriviaBankSchema, type TriviaQuestion } from '@/lib/trivia/bank-schema';

/**
 * Pure load-filter (D3): only `reviewed:true` questions enter the runtime pool,
 * so drafts (`reviewed:false`) never reach a user — the live bank grows as
 * questions are approved. Extracted as a pure function so the selector can reuse
 * it and it can be unit-tested without mocking the dynamic JSON import.
 */
export function reviewedOnly(bank: TriviaQuestion[]): TriviaQuestion[] {
  return bank.filter((q) => q.reviewed === true);
}

/**
 * Single-pass duplicate-id scan (Set-based; the previous ids.indexOf version
 * was O(n²) over a ~500-row bank). Returns each duplicated id once, in
 * first-collision order. Exported for direct unit testing.
 */
export function findDuplicateIds(rows: ReadonlyArray<{ id: string }>): string[] {
  const seen = new Set<string>();
  const dupes: string[] = [];
  const reported = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.id)) {
      if (!reported.has(r.id)) {
        dupes.push(r.id);
        reported.add(r.id);
      }
    } else {
      seen.add(r.id);
    }
  }
  return dupes;
}

/**
 * Lazily loads + validates the question bank. The dynamic import puts the
 * bank in its own chunk (like the lazy pages in App.tsx), keeping it out of
 * the cold bundle. See spec §5.3.
 *
 * Fails LOUD on a malformed bank (SEC-1): `.parse()` THROWS rather than
 * silently degrading via `safeParse` — a corrupt/edited bank must surface as
 * the calm `/learn` "couldn't load today's question" state (Step 3 of Task 11),
 * never as a half-rendered or empty quiz. We also enforce cross-row id
 * uniqueness here (the schema validates each row independently and can't see
 * duplicates across rows); a duplicate id would make the deterministic daily
 * selector ambiguous, so we throw.
 *
 * The dupe-id guard runs on the FULL parsed set first (so two drafts sharing an
 * id still fail loudly), THEN we filter to the reviewed pool (D3) — the single
 * chokepoint both consumers + the selector draw from.
 *
 * Module-level promise cache (Wave 5): the bank is a static build asset, so
 * one parse per app lifetime is enough — the Dashboard trivia card and /learn
 * no longer pay two full TriviaBankSchema.parse passes per session.
 * REJECTIONS ARE CACHED TOO (deliberate): a malformed bank is deterministic
 * per build, both consumers show calm error states, and re-parsing can't
 * heal it.
 */
let bankPromise: Promise<TriviaQuestion[]> | null = null;

// Deliberately NOT an `async function`: an async wrapper would mint a fresh
// promise per call, breaking the "two consumers share ONE promise" identity
// the cache exists for (and that the tests pin with toBe).
export function loadTriviaBank(): Promise<TriviaQuestion[]> {
  if (bankPromise) return bankPromise;
  bankPromise = (async () => {
    const raw = (await import('@/data/trivia/bank-v1.json')).default;
    const bank = TriviaBankSchema.parse(raw); // THROWS on malformed bank — caught by the page's error state
    const dupes = findDuplicateIds(bank);
    if (dupes.length > 0) {
      throw new Error(`Trivia bank has duplicate question ids: ${dupes.join(', ')}`);
    }
    return reviewedOnly(bank);
  })();
  return bankPromise;
}

/** Test-only: clears the parse cache so vitest files stay isolated. */
export function __resetTriviaBankCacheForTests(): void {
  bankPromise = null;
}
