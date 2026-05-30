import { describe, it, expect } from 'vitest';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GLOSSARY } from '@/lib/glossary';
import { generateBeginnerQuestions } from '@/lib/trivia/gen-beginner';
import { TriviaBankSchema } from '@/lib/trivia/bank-schema';
import { writeFileSync } from 'node:fs';

// Env-gated: only runs when explicitly invoked, so `npm test` never writes files.
const RUN = process.env.GEN_TRIVIA === '1';

describe.skipIf(!RUN)('generate beginner trivia (on-demand)', () => {
  it('writes schema-valid candidate beginner questions to disk', () => {
    const out = generateBeginnerQuestions(GLOSSARY);
    expect(() => TriviaBankSchema.parse(out)).not.toThrow();
    expect(out.length).toBeGreaterThan(0);

    const dir = resolve(process.cwd(), 'src/data/trivia');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const target = resolve(dir, 'bank-v1.generated.json');
    writeFileSync(target, JSON.stringify(out, null, 2) + '\n', 'utf-8');

    // Re-read and re-validate to prove the file is well-formed.
    const reread = JSON.parse(readFileSync(target, 'utf-8'));
    expect(() => TriviaBankSchema.parse(reread)).not.toThrow();
  });
});
