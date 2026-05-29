import { describe, it, expect } from 'vitest';
import { spanFor } from '@/lib/use-auto-row-span';

describe('spanFor', () => {
  // grid uses an 8px base auto-row + 16px (gap-4) row gap.
  it('computes the row span a measured height needs', () => {
    expect(spanFor(0, 8, 16)).toBe(1);
    expect(spanFor(120, 8, 16)).toBe(6);    // ceil((120+16)/(8+16)) = ceil(136/24) = 6
    expect(spanFor(400, 8, 16)).toBe(18);   // ceil((400+16)/24) = ceil(17.33) = 18
  });
});
