/**
 * Beginner-trivia generator wrapper.
 *
 * Cairn ships no standalone TS runner (no tsx / vite-node; ESM + bundler
 * resolution). The EXECUTED generator path is the env-gated Vitest driver
 * at tests/scripts/gen-glossary-trivia.gen.test.ts, run with:
 *
 *   GEN_TRIVIA=1 npx vitest run tests/scripts/gen-glossary-trivia.gen.test.ts
 *
 * That driver calls generateBeginnerQuestions(GLOSSARY) and writes the
 * candidate questions to src/data/trivia/bank-v1.generated.json (a review
 * staging file). A human curates ~40 of them into the shipped bank-v1.json.
 *
 * This file documents the same call for portability if a TS runner is added.
 * See docs/superpowers/specs/2026-05-28-trivia-learning-spec.md §6.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GLOSSARY } from '@/lib/glossary';
import { generateBeginnerQuestions } from '@/lib/trivia/gen-beginner';

export function writeGeneratedBeginnerBank(): string {
  const out = generateBeginnerQuestions(GLOSSARY);
  const target = resolve(process.cwd(), 'src/data/trivia/bank-v1.generated.json');
  writeFileSync(target, JSON.stringify(out, null, 2) + '\n', 'utf-8');
  return target;
}
