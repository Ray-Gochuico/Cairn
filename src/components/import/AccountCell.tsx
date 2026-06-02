import { useState, useEffect } from 'react';
import type { CellError } from '@/lib/import/types';

interface Props {
  value: string;
  error?: CellError;
  accounts: ReadonlyArray<{ id: number; name: string }>;
  onChange: (newName: string) => void;
}

export function AccountCell({ value, error, accounts, onChange }: Props) {
  const [editing, setEditing] = useState(!!error);

  useEffect(() => { setEditing(!!error); }, [error]);

  if (editing) {
    const matched = accounts.find(
      (a) => a.name.toLowerCase().trim() === value.toLowerCase().trim(),
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
          <option value="" disabled>
            {value ? `Pick an account (was: ${value})` : 'Pick an account…'}
          </option>
          {accounts.map((a) => (
            <option key={a.id} value={a.name}>{a.name}</option>
          ))}
        </select>
        {error && <div className="text-xs text-destructive-soft-foreground italic mt-0.5">{error.message}</div>}
      </div>
    );
  }
  return (
    <span
      className="cursor-text px-2 py-1 rounded hover:bg-muted inline-block"
      onClick={() => setEditing(true)}
    >
      {value || '—'}
    </span>
  );
}
