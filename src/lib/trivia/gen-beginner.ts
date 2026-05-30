import type { GlossaryEntry } from '@/lib/glossary';
import type { TriviaQuestion } from '@/lib/trivia/bank-schema';

/**
 * Deterministic, pure generator: maps glossary entries → candidate Beginner
 * trivia questions for human review. NO Math.random / Date.now — same input
 * yields byte-identical output so the committed JSON shows real diffs and the
 * review staging file is reproducible. See spec §6.
 *
 * Each entry becomes "Which of these best describes <term>?" with the correct
 * answer = the entry's shortDefinition and 3 distractor definitions sampled
 * deterministically from OTHER entries. An entry that can't field 3 distinct
 * distractors (tiny glossary) is skipped rather than emitting an invalid
 * (<4-choice) question.
 */

function slug(term: string): string {
  return term
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Small deterministic string hash (djb2). Stable across runs/platforms.
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

export function generateBeginnerQuestions(
  glossary: Record<string, GlossaryEntry>,
): TriviaQuestion[] {
  const entries = Object.values(glossary).filter((e) => e.shortDefinition.trim().length > 0);
  const out: TriviaQuestion[] = [];

  for (const entry of entries) {
    const correct = entry.shortDefinition;
    // Distractor pool: other entries' definitions, distinct from the correct one.
    const others = entries
      .filter((e) => e.term !== entry.term && e.shortDefinition !== correct)
      .map((e) => e.shortDefinition);
    const distinctOthers = [...new Set(others)];
    if (distinctOthers.length < 3) continue; // can't form a valid 4-choice question

    // Deterministically pick 3 distractors: order the pool by a per-entry
    // seeded key, take the first 3.
    const seed = hash(slug(entry.term));
    const ranked = distinctOthers
      .map((def, i) => ({ def, key: hash(def + ':' + seed + ':' + i) }))
      .sort((a, b) => a.key - b.key)
      .map((x) => x.def);
    const distractors = ranked.slice(0, 3);

    // Deterministically place the correct answer among the 4 slots.
    const answerIndex = seed % 4;
    const choices = [...distractors];
    choices.splice(answerIndex, 0, correct);
    // splice may push to length 4 only if distractors had 3 — guaranteed above.

    out.push({
      id: 'beg-' + slug(entry.term),
      version: 1,
      difficulty: 'Beginner',
      tags: [],
      glossaryTerm: entry.term,
      prompt: `Which of these best describes ${entry.term}?`,
      choices,
      answerIndex,
      explanation: entry.fullDefinition
        ? `${entry.shortDefinition} ${entry.fullDefinition}`
        : entry.shortDefinition,
      source: 'Cairn glossary',
    });
  }

  return out;
}
