import type { FullConfig, FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { loadSummaryLine, readLoad, type LoadPolicy } from './load-guard';

/**
 * W-I D-I6: one honest summary line per run, after the list reporter. Reads
 * the policy the config stored in `metadata`; counts timeouts apart from
 * assertion failures; never touches the exit code (a reporter cannot).
 */
export default class LoadReporter implements Reporter {
  private policy: LoadPolicy | null = null;
  private timedOut = 0;
  private failed = 0;

  onBegin(config: FullConfig): void {
    this.policy = (config.metadata as { loadPolicy?: LoadPolicy }).loadPolicy ?? null;
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
