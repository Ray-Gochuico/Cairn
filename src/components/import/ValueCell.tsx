import { useState, useRef, useEffect } from 'react';
import type { CellError } from '@/lib/import/types';

interface Props {
  value: string;
  error?: CellError;
  onChange: (next: string) => void;
}

export function ValueCell({ value, error, onChange }: Props) {
  const [editing, setEditing] = useState(!!error);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { setEditing(!!error); }, [error]);
  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

  const commit = () => {
    if (draft !== value) onChange(draft);
    if (!error) setEditing(false);
  };

  if (editing) {
    return (
      <div>
        <input
          ref={ref}
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') { setDraft(value); setEditing(!!error); }
          }}
          className={`w-full px-2 py-1 text-sm border rounded text-right tabular-nums ${error ? 'border-destructive bg-destructive/10' : 'border-input'}`}
        />
        {error && <div className="text-xs text-destructive-soft-foreground italic mt-0.5">{error.message}</div>}
      </div>
    );
  }
  return (
    <span
      className="cursor-text px-2 py-1 rounded hover:bg-slate-100 inline-block text-right tabular-nums"
      onClick={() => setEditing(true)}
    >
      {value || '—'}
    </span>
  );
}
