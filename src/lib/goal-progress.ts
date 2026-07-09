export interface GoalProgressInput {
  targetAmount: number;
  targetDate: string; // YYYY-MM-DD
  currentSaved: number;
  recentMonthlyContribution: number;
  annualGrowthRate: number; // 0..1
  today: Date;
}

export interface GoalProgressResult {
  currentSaved: number;
  percentComplete: number;
  monthsUntilTarget: number;
  linearMonthlyNeeded: number;
  /**
   * Wave-9 M23: contribution needed per month AT THE SAME growth basis the
   * on-track badge uses (annuity PMT at r, n) — the flat linear figure could
   * read ~2.4× the amount the badge's own math says suffices. Infinity when
   * the target date is now/past and the goal isn't met.
   */
  monthlyNeededWithGrowth: number;
  projectedAtTarget: number;
  onTrack: boolean;
}

/**
 * Compute progress against a savings/investment goal.
 *
 *   - monthsUntilTarget: whole months between today and targetDate (UTC), clamped to >= 0.
 *   - percentComplete: currentSaved / targetAmount (0 if targetAmount <= 0).
 *   - linearMonthlyNeeded: flat contribution needed per month to reach the gap with no growth
 *     (Infinity if target is now/past and goal not met; 0 if already at/over target).
 *   - projectedAtTarget: future value at targetDate using monthly compounding of currentSaved
 *     plus recurring contributions.
 *   - onTrack: projectedAtTarget >= targetAmount.
 */
export function computeGoalProgress(input: GoalProgressInput): GoalProgressResult {
  const target = new Date(input.targetDate);
  const monthsUntilTarget = Math.max(
    0,
    (target.getUTCFullYear() - input.today.getUTCFullYear()) * 12 +
      (target.getUTCMonth() - input.today.getUTCMonth()),
  );
  const percentComplete =
    input.targetAmount > 0 ? input.currentSaved / input.targetAmount : 0;

  const remaining = input.targetAmount - input.currentSaved;
  const linearMonthlyNeeded =
    remaining <= 0
      ? 0
      : monthsUntilTarget > 0
        ? remaining / monthsUntilTarget
        : Infinity;

  const r = input.annualGrowthRate / 12;
  const n = monthsUntilTarget;
  const projectedAtTarget =
    r === 0
      ? input.currentSaved + input.recentMonthlyContribution * n
      : input.currentSaved * Math.pow(1 + r, n) +
        (input.recentMonthlyContribution * (Math.pow(1 + r, n) - 1)) / r;

  // Wave-9 M23: the flat linear figure contradicted the growth-aware
  // on-track badge (same card, ~2.4× apart). Solve the annuity PMT at the
  // SAME r and n the badge uses: contributions that, compounding monthly,
  // close the gap left after current savings grow to the target date.
  const fvOfCurrent = r === 0 ? input.currentSaved : input.currentSaved * Math.pow(1 + r, n);
  const gapAtTarget = Math.max(0, input.targetAmount - fvOfCurrent);
  const monthlyNeededWithGrowth =
    remaining <= 0
      ? 0
      : n > 0
        ? r === 0
          ? remaining / n
          : (gapAtTarget * r) / (Math.pow(1 + r, n) - 1)
        : Infinity;

  return {
    currentSaved: input.currentSaved,
    percentComplete,
    monthsUntilTarget,
    linearMonthlyNeeded,
    monthlyNeededWithGrowth,
    projectedAtTarget,
    onTrack: projectedAtTarget >= input.targetAmount,
  };
}
