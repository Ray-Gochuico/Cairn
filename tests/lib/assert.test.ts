import { describe, it, expect } from 'vitest';
import { assertNever } from '@/lib/assert';

describe('assertNever', () => {
  it('throws when reached at runtime, naming the unexpected value', () => {
    // The argument is typed `never`, so this only compiles via a cast — which
    // is exactly the situation a real exhaustive switch protects against.
    expect(() => assertNever('ACCOUNT_FUTURE' as never)).toThrowError(/ACCOUNT_FUTURE/);
  });
});
