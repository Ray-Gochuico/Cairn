import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectSourceFiles } from './source-walker';

// Wave-10 F6/T1: an <EmptyState> ("No X yet") rendered by a page or inputs
// tab is only honest once the surface knows its stores SETTLED — otherwise
// first paint shows onboarding copy over unloaded data and a failed load
// reads as "your data vanished". The two sanctioned patterns are
// useLoadGate(...) (the Wave-10 primitive) or a direct isLoading read
// (TickersTab/HouseholdTab style). New empty states without either fail here.
// Escape hatch: `// empty-state-policy: allow — <reason>` in the first 5 lines.

const SCAN_DIRS = [
  path.resolve(__dirname, '..', '..', 'src', 'pages'),
  // Round-3 S7: components render EmptyState too — DataSection escaped the
  // pages-only scan for a full wave ("No backups yet" on first paint).
  path.resolve(__dirname, '..', '..', 'src', 'components'),
];
const ALLOW = '// empty-state-policy: allow';

function violates(source: string): boolean {
  if (!source.includes('<EmptyState')) return false;
  if (source.split('\n', 5).join('\n').includes(ALLOW)) return false;
  return !source.includes('useLoadGate(') && !source.includes('isLoading');
}

describe('empty-state gate policy (W10 F6/T1)', () => {
  it('every src/pages + src/components file rendering <EmptyState reads useLoadGate or isLoading', async () => {
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of await collectSourceFiles(dir, ['.tsx'])) {
        const source = await readFile(file, 'utf8');
        if (violates(source)) offenders.push(path.relative(process.cwd(), file));
      }
    }
    expect(
      offenders,
      `Gate the empty state on load settlement (useLoadGate) or isLoading, or add the allow marker with a reason:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  describe('violates() self-tests', () => {
    it('flags an EmptyState with no loading read', () => {
      expect(violates('<EmptyState title="No X yet" />')).toBe(true);
    });
    it('accepts useLoadGate consumers and isLoading readers', () => {
      expect(violates('const g = useLoadGate([a],[b],c); <EmptyState/>')).toBe(false);
      expect(violates('const { isLoading } = useX(); <EmptyState/>')).toBe(false);
    });
    it('a local settled flag named isLoadingX satisfies the gate (round-3 S7)', () => {
      // The isLoading substring token matches local flags like
      // isLoadingBackups — the sanctioned pattern for component-local loads.
      expect(
        violates('const [isLoadingBackups, setIsLoadingBackups] = useState(true); <EmptyState/>'),
      ).toBe(false);
    });
    it('honors the top-of-file allow marker', () => {
      expect(violates('// empty-state-policy: allow — presentational\n<EmptyState/>')).toBe(false);
    });
    it('ignores files without EmptyState', () => {
      expect(violates('export const x = 1;')).toBe(false);
    });
  });
});
