import { describe, it, expect } from 'vitest';
import { entityKey, parseEntityKey } from '@/lib/entity-key';

describe('entityKey / parseEntityKey', () => {
  it('formats account keys', () => {
    expect(entityKey('account', 42)).toBe('account:42');
  });

  it('formats property/vehicle/loan keys', () => {
    expect(entityKey('property', 5)).toBe('property:5');
    expect(entityKey('vehicle', 9)).toBe('vehicle:9');
    expect(entityKey('loan', 7)).toBe('loan:7');
  });

  it('round-trips every supported kind', () => {
    for (const kind of ['account', 'property', 'vehicle', 'loan'] as const) {
      for (const id of [1, 42, 9999]) {
        expect(parseEntityKey(entityKey(kind, id))).toEqual({ kind, id });
      }
    }
  });

  it('rejects strings without a colon', () => {
    expect(parseEntityKey('foo')).toBeNull();
    expect(parseEntityKey('account')).toBeNull();
    expect(parseEntityKey('')).toBeNull();
  });

  it('rejects unknown kinds', () => {
    expect(parseEntityKey('mystery:1')).toBeNull();
    expect(parseEntityKey('ACCOUNT:1')).toBeNull(); // case-sensitive
  });

  it('rejects non-numeric ids', () => {
    expect(parseEntityKey('account:foo')).toBeNull();
    expect(parseEntityKey('loan:')).toBeNull();
    expect(parseEntityKey('account:1.5')).toBeNull();
    expect(parseEntityKey('account:-3')).toBeNull();
  });

  it('rejects strings with extra segments', () => {
    expect(parseEntityKey('account:1:2')).toBeNull();
    expect(parseEntityKey('foo:bar')).toBeNull();
  });
});
