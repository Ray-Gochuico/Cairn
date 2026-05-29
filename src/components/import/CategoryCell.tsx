import { useState, useEffect } from 'react';
import type { CellError } from '@/lib/import/types';

interface Props {
  value: string;
  error?: CellError;
  categories: ReadonlyArray<{ id: number; name: string }>;
  onChange: (newName: string) => void;
}

export function CategoryCell({ value, error, categories, onChange }: Props) {
  const [editing, setEditing] = useState(!!error);
  useEffect(() => { setEditing(!!error); }, [error]);

  if (editing) {
    const matched = categories.find(
      (c) => c.name.toLowerCase().trim() === value.toLowerCase().trim(),
    );
    return (
      <div>
        <select
          value={matched?.name ?? ''}
          onChange={(e) => {
            onChange(e.target.value);
            if (!error) setEditing(false);
          }}
          className={`w-full px-2 py-1 text-sm border rounded ${error ? 'border-destructive bg-destructive/10' : 'border-input'}`}
        >
          <option value="">— (none)</option>
          {categories.map((c) => (
            <option key={c.id} value={c.name}>{c.name}</option>
          ))}
        </select>
        {error && <div className="text-xs text-destructive-soft-foreground italic mt-0.5">{error.message}</div>}
      </div>
    );
  }
  return (
    <span
      className="cursor-text px-2 py-1 rounded hover:bg-slate-100 inline-block"
      onClick={() => setEditing(true)}
    >
      {value || '—'}
    </span>
  );
}
