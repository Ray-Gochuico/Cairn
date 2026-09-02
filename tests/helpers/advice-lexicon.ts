/**
 * ONE advice-lexicon ratchet, shared by every W3 surface test (review MINOR
 * 0: three files carried three different, narrower regexes and drifted).
 *
 * D-W3-10/11: no registry output may rank or prescribe. Factual comparatives
 * with a COMPUTED subject ('earlier', 'higher', 'first') are the ceiling; the
 * banned set below is the plan's lead-risk vocabulary.
 *
 * EXEMPT by contract: `COMPARE_FOOTER` ("…not advice, not a recommendation.")
 * — it names the register instead of using it, and is pinned byte-exact
 * separately.
 */
export const ADVICE_LEXICON =
  /\b(should|recommend|recommends|recommended|recommendation|consider|suggest|suggests|suggested|ought|advise|advice|advisable|winner|better|best|worse|worst|optimal|ideal|smart|wise|act now)\b|\byou may want\b|don'?t miss/i;

/** Registered elsewhere in the app; W3 must never borrow either (R-LWI-3). */
export const RESERVED_PHRASES = ['Suggested next step', 'Note — not a warning.'] as const;
