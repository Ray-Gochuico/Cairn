import { useEffect, useMemo, useState } from 'react';

export interface DatePickerProps {
  /** Current value as YYYY-MM-DD, or empty string if unset. */
  value: string;
  /** Fired with YYYY-MM-DD on a complete pick, or '' if any part is cleared. */
  onChange: (next: string) => void;
  /** Optional id; used to associate label htmlFor with the year select. */
  id?: string;
  /**
   * Accessible name for the Year/Month/Day trio, e.g. "Purchase date".
   * Renders role="group" + aria-label on the wrapper and prefixes each
   * select's aria-label so "Year" is never announced context-free.
   */
  label?: string;
  /** Disables all three selects. */
  disabled?: boolean;
  /** Lowest year to offer. Defaults to 1900. */
  minYear?: number;
  /** Highest year to offer. Defaults to today's year + 1. */
  maxYear?: number;
}

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function daysInMonth(year: number, month: number): number {
  // month is 1-indexed; day 0 of next month gives last day of current
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parseValue(v: string): { year: string; month: string; day: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!match) return { year: '', month: '', day: '' };
  return { year: match[1], month: match[2], day: match[3] };
}

function compose(year: string, month: string, day: string): string {
  if (!year || !month || !day) return '';
  return `${year}-${month}-${day}`;
}

/**
 * Three native `<select>` elements for year / month / day. Replaces the
 * native `<input type="date">` which on WebKit (and therefore the Tauri
 * macOS WebView) silently emits intermediate/invalid values when the user
 * edits a single subfield. With three discrete selects, the emitted value
 * is always either a complete YYYY-MM-DD or '' — Zod validation never sees
 * a partial string.
 *
 * If the parent needs to forbid future dates (e.g. date-of-birth, purchase
 * date), the Zod schema's `pastOrTodayDate` refinement still enforces that
 * at submit time. The picker itself doesn't constrain the picks; users get
 * clear inline error messaging instead of a silent rejection.
 */
export default function DatePicker({
  value,
  onChange,
  id,
  label,
  disabled = false,
  minYear = 1900,
  maxYear,
}: DatePickerProps) {
  const today = useMemo(() => new Date(), []);
  const effectiveMaxYear = maxYear ?? today.getUTCFullYear() + 1;

  // Local state for partial selections. The parent only sees the value once
  // all three sub-fields are filled (compose returns '' otherwise), but the
  // <select>s still need to show what the user has picked so far. When the
  // parent's `value` changes from outside (e.g. defaultValues on mount, or a
  // reset), we sync local state from it.
  const [local, setLocal] = useState(() => parseValue(value));
  useEffect(() => {
    const parsed = parseValue(value);
    setLocal((prev) => {
      // If `value` corresponds to a complete date, always mirror it.
      if (parsed.year && parsed.month && parsed.day) return parsed;
      // If `value` is '' and our local state already composes to '' (i.e. it
      // represents an in-progress partial pick), leave local alone so the
      // user's partial picks survive re-renders. Otherwise (e.g. parent did
      // a true reset to '' from a previously-complete date) clear local too.
      if (!parsed.year && !parsed.month && !parsed.day) {
        if (compose(prev.year, prev.month, prev.day) === '') return prev;
        return parsed;
      }
      return parsed;
    });
  }, [value]);

  const { year, month, day } = local;

  const years = useMemo(() => {
    const result: string[] = [];
    for (let y = effectiveMaxYear; y >= minYear; y--) {
      result.push(y.toString().padStart(4, '0'));
    }
    return result;
  }, [minYear, effectiveMaxYear]);

  const maxDay = useMemo(() => {
    if (!year || !month) return 31;
    return daysInMonth(Number(year), Number(month));
  }, [year, month]);

  const days = useMemo(() => {
    const result: string[] = [];
    for (let d = 1; d <= maxDay; d++) {
      result.push(d.toString().padStart(2, '0'));
    }
    return result;
  }, [maxDay]);

  // If month rolls to one with fewer days, clamp the day silently rather
  // than emit an impossible date like 2024-02-31.
  const handle = (next: { year?: string; month?: string; day?: string }) => {
    const y = next.year ?? year;
    const m = next.month ?? month;
    let d = next.day ?? day;
    if (y && m && d) {
      const lim = daysInMonth(Number(y), Number(m));
      if (Number(d) > lim) d = lim.toString().padStart(2, '0');
    }
    setLocal({ year: y, month: m, day: d });
    onChange(compose(y, m, d));
  };

  const selectClass =
    'flex h-9 rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

  return (
    // Wave-4 a11y: labeled group so AT announces the field context once,
    // and each select's name carries the context ("Purchase date year"
    // instead of a bare "Year"). No label → no group role (R5): a nameless
    // group is announcement noise, so the wrapper stays a plain div then.
    <div
      role={label ? 'group' : undefined}
      aria-label={label}
      className="flex flex-wrap gap-2"
      data-testid={id ? `${id}-picker` : undefined}
    >
      <select
        id={id}
        aria-label={label ? `${label} year` : 'Year'}
        className={selectClass}
        disabled={disabled}
        value={year}
        onChange={(e) => handle({ year: e.target.value })}
      >
        <option value="">Year</option>
        {years.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
      <select
        aria-label={label ? `${label} month` : 'Month'}
        className={selectClass}
        disabled={disabled}
        value={month}
        onChange={(e) => handle({ month: e.target.value })}
      >
        <option value="">Month</option>
        {MONTH_LABELS.map((label, idx) => {
          const v = (idx + 1).toString().padStart(2, '0');
          return <option key={v} value={v}>{label}</option>;
        })}
      </select>
      <select
        aria-label={label ? `${label} day` : 'Day'}
        className={selectClass}
        disabled={disabled}
        value={day}
        onChange={(e) => handle({ day: e.target.value })}
      >
        <option value="">Day</option>
        {days.map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>
    </div>
  );
}
