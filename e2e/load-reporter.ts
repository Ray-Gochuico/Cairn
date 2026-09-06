import type { FullConfig, FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { loadSummaryLine, readLoad, type LoadPolicy } from './load-guard';

/**
 * W-I D-I6: one honest summary line per run, printed from onEnd — the list
 * reporter's failure epilogue prints later still (onExit), so this is one line
 * after the run summary rather than the last line of the log. Reads the policy
 * the config stored in `metadata`; counts timeouts apart from assertion
 * failures; never touches the exit code.
 *
 * A reporter CAN override the run status via onEnd's return value (Playwright
 * ≥ 1.36: `if (outResult?.status) result.status = outResult.status` in the
 * reporter multiplexer, adopted by finishTaskRun) — that is exactly how a
 * "timeouts under load shouldn't fail the run" edit would turn a failing e2e
 * run into exit 0 with every other gate green. This reporter deliberately
 * returns NOTHING from onEnd; never return a status here.
 * tests/e2e-harness/load-reporter.test.ts pins it.
 */
export default class LoadReporter implements Reporter {
  private policy: LoadPolicy | null = null;
  private timedOut = 0;
  private failed = 0;

  onBegin(config: FullConfig): void {
    this.policy = (config.metadata as { loadPolicy?: LoadPolicy } | null)?.loadPolicy ?? null;
  }

  onTestEnd(_test: TestCase, result: TestResult): void {
    if (result.status === 'timedOut') this.timedOut += 1;
    else if (result.status === 'failed' || result.status === 'interrupted') this.failed += 1;
  }

  onEnd(result: FullResult): void {
    console.log(
      loadSummaryLine({
        policy: this.policy,
        status: result.status,
        timedOut: this.timedOut,
        failed: this.failed,
        endLoad1: readLoad().load1,
      }),
    );
  }
}
