/**
 * v1.7.0 R4 smoke regression helper: what the Roadmap's two snapshot readers
 * see of ONE freshly written balance snapshot, on the Roadmap's own day.
 *
 * R4 put the interview kernel on the LOCAL calendar day — `ctx.today` is
 * dateFromLocalISO(useLocalToday()) (roadmap/context.ts) — and both readers
 * take the latest snapshot ON OR BEFORE that day: the college thread's 529
 * balance and the market-stress thread's invested portfolio. A writer that
 * stamps the UTC day dates an evening balance west of UTC TOMORROW, where
 * neither reader looks. Callers pin the clock (fake timers + TZ) first; this
 * reads the local day from that pinned clock exactly as the page does.
 */
import { dateFromLocalISO, localTodayISO } from '@/lib/dates';
import { evaluateThread } from '@/domain/interview/evaluate';
import { COLLEGE_VS_RETIREMENT_THREAD } from '@/domain/interview/threads/college-vs-retirement';
import { investedBalance } from '@/lib/interview/market-stress';
import { answerKey, type InterviewAnswer } from '@/types/interview';
import { AccountType } from '@/types/enums';
import { makeAccount, makeDependent, makeHousehold } from '../factories';
import { fixtureCtx } from '../lib/interview/fixture';

type SnapshotLike = { accountId: number; snapshotDate: string; totalValue: number };

// The college thread's clean-math household (college-vs-retirement.test.ts).
const HH = makeHousehold({
  state: 'CA',
  inflationAssumption: 0.03,
  growthScenarios: [{ label: 'moderate', rate: 0.05 }],
});
const kid = makeDependent({ id: 1, name: 'Maya', dateOfBirth: '2018-08-15' });
const monthlyAnswer: [string, InterviewAnswer] = [
  answerKey('college_vs_retirement', 'q_monthly_amount', ''),
  {
    id: 1, householdId: 1, threadId: 'college_vs_retirement', questionId: 'q_monthly_amount',
    subjectKey: '', valueJson: '500', questionVersion: 1,
    answeredAt: '2026-09-20T12:00:00.000Z', basisJson: JSON.stringify({ branch: 'has-529' }),
  },
];

export function roadmapReadsOf(snapshot: SnapshotLike): { collegeLine: string; invested: number } {
  const today = dateFromLocalISO(localTodayISO()); // roadmap/context.ts's injection
  const snapshots = [snapshot] as never;
  const college = evaluateThread(COLLEGE_VS_RETIREMENT_THREAD, fixtureCtx({
    household: HH,
    dependents: [kid],
    accounts: [makeAccount({ id: snapshot.accountId, type: AccountType.ACCOUNT_529, name: 'College 529' })],
    snapshots,
    interviewAnswers: new Map([monthlyAnswer]),
    today,
  }), '');
  if (college.state !== 'reply' || college.reply.kind !== 'plan') {
    throw new Error('expected the college reply');
  }
  const invested = investedBalance(fixtureCtx({
    accounts: [makeAccount({ id: snapshot.accountId, type: AccountType.ACCOUNT_BROKERAGE, name: 'Brokerage' })],
    snapshots,
    today,
  }));
  return { collegeLine: college.reply.lines[1], invested };
}
