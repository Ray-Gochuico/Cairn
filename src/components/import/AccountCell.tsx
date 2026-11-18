import { useState, useEffect, useRef } from 'react';
import type { CellError } from '@/lib/import/types';

interface Props {
  value: string;
  error?: CellError;
  accounts: ReadonlyArray<{ id: number; name: string }>;
  onChange: (newName: string) => void;
}

export function AccountCell({ value, error, accounts, onChange }: Props) {
  const [editing, setEditing] = useState(!!error);
  const selectRef = useRef<HTMLSelectElement>(null);

  // v1.8.0 W4 (task_90fd839b, from the O1 smoke): a native select's typeahead
  // picks on each key, so a pick must not close the dropdown while it has
  // focus, or typing stops at the first match. An error opens it; once the
  // account is good it closes when focus leaves it, or at once if it does
  // not have focus.
  useEffect(() => {
    if (error) setEditing(true);
    else if (document.activeElement !== selectRef.current) setEditing(false);
  }, [error]);

  if (editing) {
    const matched = accounts.find(
      (a) => a.name.toLowerCase().trim() === value.toLowerCase().trim(),
    );
    return (
      <div>
        <select
          ref={selectRef}
          value={matched?.name ?? ''}
          onChange={(e) => {
            onChange(e.target.value);
            // A pick made without focus (a pointer pick where the engine does
            // not focus a select) closes at once, as before.
            if (!error && document.activeElement !== e.currentTarget) setEditing(false);
          }}
          onBlur={() => {
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
