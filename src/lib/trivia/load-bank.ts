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
 */
export async function loadTriviaBank(): Promise<TriviaQuestion[]> {
  const raw = (await import('@/data/trivia/bank-v1.json')).default;
  const bank = TriviaBankSchema.parse(raw); // THROWS on malformed bank — caught by the page's error state
  const ids = bank.map((q) => q.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length > 0) {
    throw new Error(`Trivia bank has duplicate question ids: ${[...new Set(dupes)].join(', ')}`);
  }
  return reviewedOnly(bank);
}
