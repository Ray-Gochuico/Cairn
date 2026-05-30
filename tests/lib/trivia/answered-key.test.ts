import { describe, it, expect } from 'vitest';
import { answeredKey } from '@/lib/trivia/answered-key';

describe('answeredKey', () => {
  it('is version-aware: same id, different versions produce distinct keys', () => {
    expect(answeredKey('beg-apr', 1)).toBe('beg-apr@v1');
    expect(answeredKey('beg-apr', 2)).toBe('beg-apr@v2');
    expect(answeredKey('beg-apr', 1)).not.toBe(answeredKey('beg-apr', 2));
  });
});
