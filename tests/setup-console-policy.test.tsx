import { describe, expect, it } from 'vitest';

describe('tests/setup.ts console.error policy', () => {
  it('throws when the Radix DialogTitle warning fires', () => {
    expect(() => {
      console.error(
        'Warning: `DialogContent` requires a `DialogTitle` for the component to be accessible for screen reader users.',
      );
    }).toThrow(/Forbidden console\.error/);
  });

  it('lets unrelated console.error messages through without throwing', () => {
    expect(() => {
      console.error('Some unrelated warning that should pass.');
    }).not.toThrow();
  });
});
