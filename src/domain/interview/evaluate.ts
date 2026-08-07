import type {
  AnswerValues, DataBranchNode, InterviewContext, InterviewNode, InterviewNodeId,
  InterviewThread, PreferenceNode, StoredAnswerView, SubjectKey, ThreadEvaluation,
} from '@/types/interview';
import { answerKey } from '@/types/interview';

/** Registry bug guard — no phase-1 thread is longer than a handful of nodes. */
const MAX_STEPS = 50;

/** Whole calendar months between two ISO dates (the debt-payoff idiom). */
export function monthsBetweenIso(fromIso: string, toIso: string): number {
  const [fy, fm] = [Number(fromIso.slice(0, 4)), Number(fromIso.slice(5, 7))];
  const [ty, tm] = [Number(toIso.slice(0, 4)), Number(toIso.slice(5, 7))];
  return (ty - fy) * 12 + (tm - fm);
}

export function subjectsOf(thread: InterviewThread, ctx: InterviewContext): SubjectKey[] {
  if (thread.subject?.kind === 'vehicle') {
    return ctx.vehicles.filter((v) => v.id != null).map((v) => `vehicle:${v.id}`);
  }
  return [''];
}

export function branchKeyOf(node: PreferenceNode, value: unknown): string {
  return node.answer.kind === 'enum' ? String(value) : '*';
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined; // fails the node's Zod check → re-ask (D-GI16)
  }
}

function parseBasis(raw: string | null): { branch: string } | null {
  if (raw == null) return null;
  const parsed = safeParseJson(raw);
  if (parsed && typeof parsed === 'object' && typeof (parsed as { branch?: unknown }).branch === 'string') {
    return { branch: (parsed as { branch: string }).branch };
  }
  return null;
}

function readAnswer(
  node: PreferenceNode,
  thread: InterviewThread,
  ctx: InterviewContext,
  subject: SubjectKey,
  session: ReadonlyMap<InterviewNodeId, unknown> | undefined,
): StoredAnswerView | null {
  if (node.storage.kind === 'session') {
    const v = session?.get(node.id);
    return v === undefined
      ? null
      : { value: v, questionVersion: node.version, answeredAt: null, basis: null };
  }
  if (node.storage.kind === 'entity-column') {
    const v = node.storage.read(ctx, subject);
    return v == null
      ? null
      : { value: v, questionVersion: node.version, answeredAt: null, basis: null };
  }
  const row = ctx.interviewAnswers.get(answerKey(thread.id, node.id, subject));
  if (!row) return null;
  return {
    value: safeParseJson(row.valueJson),
    questionVersion: row.questionVersion,
    answeredAt: row.answeredAt,
    basis: parseBasis(row.basisJson),
  };
}

function isAgeStale(node: PreferenceNode, stored: StoredAnswerView, today: Date): boolean {
  if (node.staleAfterMonths == null || stored.answeredAt == null) return false;
  const todayIso = today.toISOString().slice(0, 10);
  return monthsBetweenIso(stored.answeredAt.slice(0, 10), todayIso) >= node.staleAfterMonths;
}

/**
 * Walk one thread for one subject: data-branches route on live data,
 * preferences route on stored answers (with the four re-ask mechanisms:
 * version bump, basis change, age staleness, and — via the store's delete —
 * explicit clear), replies compute live. Pure over (thread, ctx, subject,
 * session); ctx.today is the only clock.
 */
export function evaluateThread(
  thread: InterviewThread,
  ctx: InterviewContext,
  subject: SubjectKey,
  session?: ReadonlyMap<InterviewNodeId, unknown>,
): ThreadEvaluation {
  const byId = new Map<InterviewNodeId, InterviewNode>(thread.nodes.map((n) => [n.id, n]));
  let nodeId: InterviewNodeId | null = thread.entry;
  let lastBranch: { branch: string; facts: Record<string, unknown> } | null = null;
  const answeredValues = new Map<InterviewNodeId, unknown>();
  const answeredPath: { node: PreferenceNode; answer: StoredAnswerView }[] = [];
  const staleAnswers: { node: PreferenceNode; answer: StoredAnswerView }[] = [];

  for (let step = 0; step < MAX_STEPS && nodeId != null; step += 1) {
    const node = byId.get(nodeId);
    if (!node) throw new Error(`interview: unknown node '${nodeId}' in thread '${thread.id}'`);

    if (node.kind === 'data-branch') {
      lastBranch = node.evaluate(ctx, subject);
      const next: InterviewNodeId | null | undefined = (node as DataBranchNode).branches[lastBranch.branch];
      if (next === undefined) {
        throw new Error(`interview: thread '${thread.id}' node '${node.id}' has no branch '${lastBranch.branch}'`);
      }
      if (next === null) return { state: 'hidden' };
      nodeId = next;
      continue;
    }

    if (node.kind === 'preference') {
      const pinBasis = lastBranch ? { branch: lastBranch.branch, facts: lastBranch.facts } : null;
      const stored = readAnswer(node, thread, ctx, subject, session);
      if (stored == null) {
        return { state: 'ask', node, subject, reason: 'unanswered', priorAnswer: null, pinBasis };
      }
      if (stored.questionVersion < node.version) {
        return { state: 'ask', node, subject, reason: 'version-changed', priorAnswer: stored, pinBasis };
      }
      if (stored.basis != null && lastBranch != null && stored.basis.branch !== lastBranch.branch) {
        return { state: 'ask', node, subject, reason: 'basis-changed', priorAnswer: stored, pinBasis };
      }
      const parsed = node.valueSchema.safeParse(stored.value);
      if (!parsed.success) {
        // D-GI16: corrupt row = unanswered; the next answer overwrites it.
        return { state: 'ask', node, subject, reason: 'unanswered', priorAnswer: null, pinBasis };
      }
      if (isAgeStale(node, stored, ctx.today)) staleAnswers.push({ node, answer: stored });
      answeredValues.set(node.id, parsed.data);
      answeredPath.push({ node, answer: stored });
      const next = node.branches[branchKeyOf(node, parsed.data)] ?? node.branches['*'];
      if (next === undefined) {
        throw new Error(`interview: thread '${thread.id}' node '${node.id}' has no branch for the stored answer`);
      }
      nodeId = next;
      continue;
    }

    // reply — terminal
    const answers: AnswerValues = answeredValues;
    return {
      state: 'reply', node, subject,
      reply: node.compute(ctx, answers, subject),
      answeredPath, staleAnswers,
    };
  }
  throw new Error(`interview: thread '${thread.id}' walk did not terminate`);
}
