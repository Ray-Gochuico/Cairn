import type { LeverPayload } from '@/lib/scenarios';

export interface SummarizeContext {
  loanNames: Record<number, string>;
}

const DEFAULT_RAISE = 0;
const DEFAULT_RETURN = 0.07;

function formatMoney(n: number): string {
  const sign = n < 0 ? '-' : '+';
  const abs = Math.abs(n);
  if (abs >= 1000) return `${sign}$${abs.toLocaleString('en-US')}`;
  return `${sign}$${abs}`;
}

function fmtMonth(iso: string): string {
  return iso.slice(0, 7);
}

function fmtPct(rate: number): string {
  return `${(rate * 100).toFixed(0)}%`;
}

export function summarizeLevers(payload: LeverPayload, ctx: SummarizeContext): string {
  const parts: string[] = [];

  for (const elp of payload.extraLoanPayments) {
    const name = ctx.loanNames[elp.loanId] ?? `Loan #${elp.loanId}`;
    const window =
      elp.start || elp.end
        ? `${elp.start ? fmtMonth(elp.start) : '∞'} → ${elp.end ? fmtMonth(elp.end) : '∞'}`
        : 'Always';
    parts.push(`${formatMoney(elp.extraMonthly)}/mo on ${name} (${window})`);
  }

  for (const evt of payload.lumpSums) {
    const tag = evt.label ?? (evt.destination === 'cash' ? 'cash' : 'investments');
    parts.push(`Lump sum ${fmtMonth(evt.when)}: ${formatMoney(evt.amount)}${tag ? ` (${tag})` : ''}`);
  }

  for (const period of payload.expensePeriods) {
    const labelSuffix = period.label ? ` (${period.label})` : '';
    parts.push(
      `Expenses ${fmtMonth(period.start)} × ${period.durationMonths}mo: ${formatMoney(period.monthlyDelta)}/mo${labelSuffix}`,
    );
  }

  const overrideYearCount = Object.keys(payload.returns.overrides).length;
  if (overrideYearCount > 0 || payload.returns.defaultRate !== DEFAULT_RETURN) {
    const def =
      payload.returns.defaultRate !== DEFAULT_RETURN
        ? ` default ${fmtPct(payload.returns.defaultRate)}`
        : '';
    parts.push(`Returns: ${overrideYearCount} years overridden${def}`);
  }

  const raises = payload.income.perPerson.map((p) => fmtPct(p.annualRaiseRate));
  const nonDefaultRaises = payload.income.perPerson.some((p) => p.annualRaiseRate !== DEFAULT_RAISE);
  if (nonDefaultRaises) parts.push(`Raises: ${raises.join(' / ')}`);

  const totalEvents = payload.income.perPerson.reduce((acc, p) => acc + p.events.length, 0);
  if (totalEvents > 0) parts.push(`Income events: ${totalEvents}`);

  for (const seg of payload.contributions) {
    const startYear = Math.floor(seg.startMonth / 12) + 1;
    const endYear = seg.endMonth === null ? '∞' : Math.floor(seg.endMonth / 12) + 1;
    const window = `Y${startYear}-${endYear}`;
    parts.push(`Contribute ${formatMoney(seg.monthlyAmount)}/mo (${window})`);
  }

  if (parts.length === 0) return 'No overrides';
  return parts.join('; ');
}
