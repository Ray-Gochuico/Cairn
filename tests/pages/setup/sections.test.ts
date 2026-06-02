import { describe, it, expect } from 'vitest';
import { SECTIONS } from '@/pages/setup/sections';

describe('setup wizard SECTIONS metadata', () => {
  it('Section 3 (What you owe) carries an intro message', () => {
    const section3 = SECTIONS.find((s) => s.index === 3);
    expect(section3).toBeDefined();
    expect(section3!.label).toBe('What you owe');
    expect(section3!.intro?.trim()).toBeTruthy();
  });

  it('the Section 3 intro keeps the calm "skip" affordance', () => {
    const section3 = SECTIONS.find((s) => s.index === 3)!;
    // SINGLE stable word (must-fix W6): key on ONE durable word ("skip"),
    // not a multi-word phrase set, so a copy tweak that preserves the
    // skip-this-section affordance does not break this test. Keep this
    // anchor identical to the one in Section3_WhatYouOwe.test.tsx. If the
    // final copy drops "skip", change BOTH to the same new single word.
    expect(section3.intro?.toLowerCase()).toMatch(/skip/);
  });
});
