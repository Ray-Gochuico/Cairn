// @vitest-environment node
import type { FullConfig, FullResult, TestCase, TestResult } from '@playwright/test/reporter';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPolicy, loadSummaryLine, type LoadPolicy } from '../../e2e/load-guard';

/**
 * W-I review fix (MAJOR 0/1): the reporter's ONE load-bearing rule is that it
 * never changes the run status. Playwright 1.61 DOES honor a status returned
 * from a reporter's onEnd (runner/index.js: `if (outResult?.status) result.status
 * = outResult.status`), so "a reporter cannot" was false and nothing pinned the
 * rule: a two-line edit returning `{ status: 'passed' }` turned a failing e2e
 * run into exit 0 while every static and unit gate stayed green. These tests
 * drive the reporter class directly.
 */

/** The end-of-run reading is frozen so the printed line can be compared byte for byte. */
const { END } = vi.hoisted(() => ({ END: { load1: 3.25, cores: 10 } }));
vi.mock('../../e2e/load-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../e2e/load-guard')>();
  return { ...actual, readLoad: () => END };
});

const { default: LoadReporter } = await import('../../e2e/load-reporter');

const POLICY: LoadPolicy = loadPolicy({ load1: 9.3, cores: 10, ci: false, env: {} });
const configWith = (metadata: unknown): FullConfig => ({ metadata } as unknown as FullConfig);
const result = (status: TestResult['status']): TestResult => ({ status }) as TestResult;
const CASE = {} as TestCase;

/** Drive one whole run; return what onEnd gave back and every line it printed. */
async function run(
  metadata: unknown,
  statuses: ReadonlyArray<TestResult['status']>,
  status: FullResult['status'] = 'failed',
): Promise<{ returned: unknown; printed: string[] }> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const reporter = new LoadReporter();
  reporter.onBegin?.(configWith(metadata), {} as never);
  for (const s of statuses) reporter.onTestEnd?.(CASE, result(s));
  const returned: unknown = await Promise.resolve(
    reporter.onEnd?.({ status } as FullResult) as unknown,
  );
  const printed = log.mock.calls.map((c) => String(c[0]));
  log.mockRestore();
  return { returned, printed };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LoadReporter (W-I D-I6) — it reports, it never decides', () => {
  it('onEnd returns nothing — a returned { status } would override the run status and mask a failing run', async () => {
    const { returned } = await run({ loadPolicy: POLICY }, ['failed']);
    expect(returned).toBeUndefined();
    expect((returned as { status?: string } | undefined)?.status).toBeUndefined();
  });

  it('prints exactly the summary line, counting timeouts apart from failures (interrupted counts as a failure)', async () => {
    const { printed } = await run({ loadPolicy: POLICY }, [
      'passed',
      'failed',
      'timedOut',
      'interrupted',
    ]);
    expect(printed).toEqual([
      loadSummaryLine({
        policy: POLICY,
        status: 'failed',
        timedOut: 1,
        failed: 2,
        endLoad1: END.load1,
      }),
    ]);
  });

  it('a green run still gets its one line, and still no status', async () => {
    const { returned, printed } = await run({ loadPolicy: POLICY }, ['passed', 'passed'], 'passed');
    expect(returned).toBeUndefined();
    expect(printed).toEqual([
      loadSummaryLine({
        policy: POLICY,
        status: 'passed',
        timedOut: 0,
        failed: 0,
        endLoad1: END.load1,
      }),
    ]);
  });

  it('a config that carries no loadPolicy (a foreign runner) still prints one honest line', async () => {
    for (const metadata of [{}, null]) {
      const { returned, printed } = await run(metadata, ['timedOut']);
      expect(returned).toBeUndefined();
      expect(printed).toEqual([
        loadSummaryLine({
          policy: null,
          status: 'failed',
          timedOut: 1,
          failed: 0,
          endLoad1: END.load1,
        }),
      ]);
      expect(printed[0]).toContain('n/a');
    }
  });

  it('the line it prints keeps the owner hard lines (no exclamation mark, never "you should")', async () => {
    const { printed } = await run({ loadPolicy: POLICY }, ['timedOut', 'failed']);
    expect(printed).toHaveLength(1);
    expect(printed[0]).not.toMatch(/!/);
    expect(printed[0]).not.toMatch(/you should/i);
  });
});
