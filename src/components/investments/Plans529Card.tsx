import { memo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Account, AccountSnapshot, Contribution, Dependent } from '@/types/schema';
import { formatCurrency } from '@/lib/format';

/**
 * 529 Plans card body — extracted 1:1 from the Investments page cardRegistry
 * (wave-7 W4). The page keeps the plans/dependent/snapshot memos (shared
 * upstream sets) and threads them in; `today` arrives as a prop (the page's
 * useMemo'd new Date()) so this component stays clock-free at module scope.
 */

/**
 * Project a 529 plan's value forward to the beneficiary's 18th birthday.
 * Uses monthly compounding at `growthRate` annual, plus the beneficiary's
 * recent monthly contribution rate. Returns `currentValue` if the
 * beneficiary is already 18 or older (monthsUntil clamps to 0).
 */
function projectedAtAge18(
  currentValue: number,
  monthlyContrib: number,
  dobIso: string,
  growthRate: number,
  now: Date,
): number {
  const dob = new Date(dobIso);
  const eighteen = new Date(dob);
  eighteen.setFullYear(eighteen.getFullYear() + 18);
  const monthsUntil = Math.max(
    0,
    (eighteen.getFullYear() - now.getFullYear()) * 12 +
      (eighteen.getMonth() - now.getMonth()),
  );
  const r = growthRate / 12;
  if (r === 0) return currentValue + monthlyContrib * monthsUntil;
  return (
    currentValue * Math.pow(1 + r, monthsUntil) +
    (monthlyContrib * (Math.pow(1 + r, monthsUntil) - 1)) / r
  );
}

export interface Plans529CardProps {
  plans: Account[];
  dependentById: Map<number, Dependent>;
  latestSnapByAccount: Map<number, AccountSnapshot>;
  contributions: Contribution[];
  today: Date;
  moderateRate: number;
}

function Plans529CardImpl({
  plans,
  dependentById,
  latestSnapByAccount,
  contributions,
  today,
  moderateRate,
}: Plans529CardProps) {
  return (
    <Card data-testid="529-section">
      <CardHeader>
        <CardTitle>529 Plans</CardTitle>
        <CardDescription>
          College savings — current value, contributions YTD, and
          projected value at the beneficiary's 18th birthday using the
          Moderate growth scenario ({(moderateRate * 100).toFixed(1)}%).
          {/* Round-3 E3: state the truncation instead of implying a total. */}
          {' '}Projection stops at the 18th birthday — real 529s keep
          compounding (and can keep receiving contributions) through the
          college years, so this is a floor.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {plans.map((plan) => {
            const dep =
              plan.beneficiaryDependentId != null
                ? dependentById.get(plan.beneficiaryDependentId)
                : null;
            const latestSnap =
              plan.id != null ? latestSnapByAccount.get(plan.id) : undefined;
            const currentValue = latestSnap?.totalValue ?? 0;
            // YTD = sum of contributions in the current calendar year.
            const yearPrefix = String(today.getFullYear());
            const ytdContribs = contributions
              .filter(
                (c) =>
                  c.accountId === plan.id && c.date.startsWith(yearPrefix),
              )
              .reduce((sum, c) => sum + c.amount, 0);
            // Approximate the projection's monthly inflow with YTD ÷ months
            // elapsed this year. Coarse but matches what the user can see
            // in the contribution log; refines automatically as the year
            // progresses.
            const monthsThisYear = today.getMonth() + 1;
            const monthlyAvg =
              monthsThisYear > 0 ? ytdContribs / monthsThisYear : 0;
            const projected =
              dep != null
                ? projectedAtAge18(
                    currentValue,
                    monthlyAvg,
                    dep.dateOfBirth,
                    moderateRate,
                    today,
                  )
                : currentValue;
            return (
              <li
                key={plan.id}
                className="flex items-center justify-between gap-4 py-3"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{plan.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {dep ? `for ${dep.name}` : 'no beneficiary set'}
                    {plan.stateOfPlan ? ` · ${plan.stateOfPlan}` : ''}
                    {plan.institution ? ` · ${plan.institution}` : ''}
                  </div>
                </div>
                <div className="text-right shrink-0 text-sm space-y-0.5">
                  <div className="font-mono tabular-nums">
                    {formatCurrency(currentValue)}{' '}
                    <span className="text-muted-foreground">now</span>
                  </div>
                  <div className="font-mono tabular-nums">
                    {formatCurrency(ytdContribs)}{' '}
                    <span className="text-muted-foreground">YTD</span>
                  </div>
                  {dep != null && (
                    <div className="font-mono tabular-nums">
                      {formatCurrency(projected)}{' '}
                      <span className="text-muted-foreground">at 18</span>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

const Plans529Card = memo(Plans529CardImpl);
Plans529Card.displayName = 'Plans529Card';
export default Plans529Card;
