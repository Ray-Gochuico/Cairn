import { describe, expect, it, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { usePersonsStore } from '@/stores/persons-store';
import { useViewScope } from '@/lib/use-view-scope';
import { makePerson } from '../factories';

function wrapper(entry: string) {
  return ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>
  );
}

describe('useViewScope', () => {
  beforeEach(() => {
    usePersonsStore.setState({
      persons: [makePerson({ id: 1, name: 'Alice' }), makePerson({ id: 2, name: 'Bob' })],
      isLoading: false, error: null, load: async () => {},
    } as never);
  });

  it('p2 view: names and labels resolve', () => {
    const { result } = renderHook(() => useViewScope(), { wrapper: wrapper('/x?view=p2') });
    expect(result.current.isFiltered).toBe(true);
    expect(result.current.personName).toBe('Bob');
    expect(result.current.otherName).toBe('Alice');
    expect(result.current.scopeLabel).toBe('Bob');
  });
  it('joint view: scopeLabel Joint, no personName', () => {
    const { result } = renderHook(() => useViewScope(), { wrapper: wrapper('/x?view=joint') });
    expect(result.current.personName).toBeNull();
    expect(result.current.scopeLabel).toBe('Joint');
  });
  it('household default', () => {
    const { result } = renderHook(() => useViewScope(), { wrapper: wrapper('/x') });
    expect(result.current.isFiltered).toBe(false);
    expect(result.current.scopeLabel).toBe('Household');
  });
});
