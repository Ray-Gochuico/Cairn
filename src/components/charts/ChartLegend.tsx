/**
 * House legend (Wave 11): hue lives in the DOT, never in the text — the
 * recharts default colors the label text with the series stroke, which
 * fails 4.5:1 in dark mode. Drop-in for recharts <Legend content={...}>.
 */
export function ChartLegend({
  payload,
}: {
  payload?: ReadonlyArray<{ value?: unknown; color?: string }>;
}) {
  if (!payload?.length) return null;
  return (
    <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 pt-2 text-xs text-muted-foreground">
      {payload.map((entry, i) => (
        <li key={i} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: entry.color }}
          />
          {String(entry.value)}
        </li>
      ))}
    </ul>
  );
}
