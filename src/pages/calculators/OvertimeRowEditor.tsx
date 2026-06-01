import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { OvertimeLineItem } from '@/lib/overtime';

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

// Preset is carried alongside OvertimeLineItem fields in the row state so the
// editor and parent share a single update channel via Partial<…>. (Cleaner
// than tracking presets in a parallel Record on the parent.)
export type OvertimePreset = '1.5' | '2' | 'custom';
export type OvertimeRow = OvertimeLineItem & { preset: OvertimePreset };

export interface OvertimeRowEditorProps {
  row: OvertimeRow;
  index: number;
  onChange: (patch: Partial<OvertimeRow>) => void;
  onRemove: () => void;
  canRemove: boolean;
}

export function OvertimeRowEditor({
  row,
  index,
  onChange,
  onRemove,
  canRemove,
}: OvertimeRowEditorProps) {
  const hoursId = `ot-row-${index}-hours`;
  const presetId = `ot-row-${index}-preset`;
  const customId = `ot-row-${index}-custom`;
  const holidayId = `ot-row-${index}-holiday`;
  const stackId = `ot-row-${index}-stack`;
  const shiftDiffId = `ot-row-${index}-shiftdiff`;

  return (
    <div
      className="rounded-md border bg-muted/30 p-3 space-y-2"
      data-testid={`ot-row-${index}`}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor={hoursId} className="text-xs font-medium">
            Hours
          </label>
          <Input
            id={hoursId}
            type="number"
            min="0"
            step="0.25"
            value={row.hours === 0 ? '' : row.hours}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              onChange({ hours: Number.isFinite(v) && v >= 0 ? v : 0 });
            }}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={shiftDiffId} className="text-xs font-medium">
            Shift diff ($/hr)
          </label>
          <Input
            id={shiftDiffId}
            type="number"
            min="0"
            step="0.25"
            value={row.shiftDifferential === 0 || row.shiftDifferential === undefined ? '' : row.shiftDifferential}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              onChange({ shiftDifferential: Number.isFinite(v) && v >= 0 ? v : 0 });
            }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor={presetId} className="text-xs font-medium">
            Multiplier
          </label>
          <select
            id={presetId}
            className={SELECT_CLASS}
            value={row.preset}
            onChange={(e) => {
              const next = e.target.value as OvertimePreset;
              if (next === '1.5') onChange({ preset: '1.5', baseMultiplier: 1.5 });
              else if (next === '2') onChange({ preset: '2', baseMultiplier: 2 });
              else onChange({ preset: 'custom' });
            }}
          >
            <option value="1.5">1.5x (time-and-a-half)</option>
            <option value="2">2x (double-time)</option>
            <option value="custom">Custom</option>
          </select>
        </div>
      </div>

      {row.preset === 'custom' && (
        <div className="space-y-1">
          <label htmlFor={customId} className="text-xs font-medium">
            Custom multiplier
          </label>
          <Input
            id={customId}
            type="number"
            min="0"
            step="0.05"
            value={row.baseMultiplier}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              onChange({ baseMultiplier: Number.isFinite(v) ? v : 0 });
            }}
          />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor={holidayId} className="text-xs font-medium">
            Holiday multiplier (optional)
          </label>
          <Input
            id={holidayId}
            type="number"
            min="0"
            step="0.05"
            value={row.holidayMultiplier ?? ''}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === '') {
                onChange({ holidayMultiplier: null });
                return;
              }
              const v = parseFloat(raw);
              onChange({ holidayMultiplier: Number.isFinite(v) ? v : null });
            }}
          />
        </div>
        <div className="flex items-end">
          <label
            htmlFor={stackId}
            className="text-xs font-medium flex items-center gap-2"
          >
            <input
              id={stackId}
              type="checkbox"
              checked={row.stackMultipliers}
              disabled={row.holidayMultiplier === null}
              onChange={(e) => onChange({ stackMultipliers: e.target.checked })}
            />
            Stack with base
          </label>
        </div>
      </div>

      {canRemove && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRemove}
            aria-label={`Remove row ${index + 1}`}
          >
            Remove
          </Button>
        </div>
      )}
    </div>
  );
}
