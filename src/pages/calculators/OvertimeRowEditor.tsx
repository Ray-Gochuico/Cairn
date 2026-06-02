import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import type { OvertimeLineItem } from '@/lib/overtime';
import { NumberField } from '@/components/calculators/NumberField';

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
        <NumberField
          id={hoursId}
          label="Hours"
          value={row.hours === 0 ? null : row.hours}
          onChange={(v) => onChange({ hours: v ?? 0 })}
          min={0}
          step="0.25"
        />
        <NumberField
          id={shiftDiffId}
          label="Shift diff ($/hr)"
          value={(row.shiftDifferential ?? 0) === 0 ? null : (row.shiftDifferential ?? 0)}
          onChange={(v) => onChange({ shiftDifferential: v ?? 0 })}
          min={0}
          step="0.25"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor={presetId} className="text-xs font-medium">Multiplier</Label>
          <Select
            value={row.preset}
            onValueChange={(v) => {
              const next = v as OvertimePreset;
              if (next === '1.5') onChange({ preset: '1.5', baseMultiplier: 1.5 });
              else if (next === '2') onChange({ preset: '2', baseMultiplier: 2 });
              else onChange({ preset: 'custom' });
            }}
          >
            <SelectTrigger id={presetId} aria-label="Multiplier">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1.5">1.5x (time-and-a-half)</SelectItem>
              <SelectItem value="2">2x (double-time)</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {row.preset === 'custom' && (
        <NumberField
          id={customId}
          label="Custom multiplier"
          value={row.baseMultiplier}
          onChange={(v) => onChange({ baseMultiplier: v ?? 0 })}
          min={0}
          step="0.05"
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <NumberField
          id={holidayId}
          label="Holiday multiplier (optional)"
          value={row.holidayMultiplier}
          onChange={(v) => onChange({ holidayMultiplier: v })}
          min={0}
          step="0.05"
        />
        <div className="flex items-end">
          <label
            htmlFor={stackId}
            className="text-xs font-medium flex items-center gap-2"
          >
            <Checkbox
              id={stackId}
              checked={row.stackMultipliers}
              disabled={row.holidayMultiplier === null}
              onCheckedChange={(checked) => onChange({ stackMultipliers: checked === true })}
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
