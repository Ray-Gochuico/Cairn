/**
 * Shared sub-components used by both the Property and Vehicles asset-equity
 * pages. Extracted to avoid bit-for-bit duplication.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export function formatCurrencyShared(value: number): string {
  return currencyFormatter.format(value);
}

export interface ValueEditorProps {
  initialValue: number | null;
  onSave: (value: number | null) => Promise<void>;
  onCancel: () => void;
}

export function ValueEditor({ initialValue, onSave, onCancel }: ValueEditorProps) {
  const [text, setText] = useState<string>(
    initialValue != null ? String(initialValue) : '',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    const trimmed = text.trim();
    let parsed: number | null;
    if (trimmed === '') {
      parsed = null;
    } else {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n < 0) {
        setError('Enter a non-negative number, or leave blank to clear.');
        return;
      }
      parsed = n;
    }
    setSaving(true);
    try {
      await onSave(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 rounded-md border bg-muted/30 p-3 space-y-2">
      <Label htmlFor="value-editor-input" className="text-xs">
        Current estimated value
      </Label>
      <Input
        id="value-editor-input"
        type="number"
        min={0}
        step="any"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={saving}
      />
      {error ? (
        <div className="text-xs text-destructive">{error}</div>
      ) : null}
      <div className="flex gap-2 justify-end">
        <Button
          size="sm"
          variant="outline"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

export interface EquityRowProps {
  label: string;
  value: number;
  tone?: 'negative';
}

export function EquityRow({ label, value, tone }: EquityRowProps) {
  const isNegative = tone === 'negative' || value < 0;
  return (
    <div className="flex items-center justify-between border-t pt-3">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span
        className={`text-lg font-semibold ${
          isNegative ? 'text-destructive' : 'text-success'
        }`}
      >
        {currencyFormatter.format(value)}
      </span>
    </div>
  );
}
