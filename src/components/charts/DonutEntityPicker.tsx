import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useDonutSelection } from './useDonutSelection';

export interface DonutEntityPickerItem {
  /** Stable string key (matches the donut's slice key). */
  key: string;
  /** Display label for the checkbox row. */
  label: string;
  /** Optional swatch color (matches the slice in the donut). */
  color?: string;
}

interface Props {
  /** localStorage key — convention: `donut.<name>.hidden` */
  localStorageKey: string;
  /** All eligible items (their `key` defines the universe of `allKeys`). */
  items: ReadonlyArray<DonutEntityPickerItem>;
  /**
   * No longer shown on the trigger (which reads "Included · n of m",
   * the app-wide IncludedPicker grammar); names the dialog for SRs via
   * `aria-label="<buttonLabel> picker"`. Default: "Entities".
   */
  buttonLabel?: string;
}

/**
 * Reusable header popover for donut entity-visibility selection. Owns
 * its own `useDonutSelection` instance and persists to localStorage.
 * Consumers use the companion `useDonutSelected` hook (defined below)
 * to read the same selected set in their data-filter step. Both must
 * pass the SAME `localStorageKey` and `allKeys` for the picker and the
 * donut to stay in lockstep.
 */
export function DonutEntityPicker({
  localStorageKey,
  items,
  buttonLabel = 'Entities',
}: Props) {
  const allKeys = useMemo(() => items.map((i) => i.key), [items]);
  const { selected, toggle, showAll, hideAll } = useDonutSelection(
    localStorageKey,
    allKeys,
  );
  const [open, setOpen] = useState(false);

  // Esc closes the picker. preventDefault marks the event handled so any
  // window-level Esc consumers registered earlier (e.g. AssetValueChart's
  // pin-Esc, which checks defaultPrevented) defer to the popover.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div className="relative">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        Included · {selected.size} of {items.length}
      </Button>
      {open && (
        <>
          <div
            data-testid="donut-picker-backdrop"
            className="fixed inset-0 z-10"
            aria-hidden="true"
            onMouseDown={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label={`${buttonLabel} picker`}
            className="absolute right-0 top-full mt-2 w-64 rounded-md border bg-background shadow-lg p-2 z-20"
          >
            <div className="flex items-center justify-between px-1.5 pb-2 mb-1 border-b">
              <Button type="button" variant="link" size="sm" onClick={showAll}>
                Show all
              </Button>
              <Button type="button" variant="link" size="sm" onClick={hideAll}>
                Hide all
              </Button>
            </div>
            <ul className="space-y-1 max-h-72 overflow-y-auto">
              {items.map((it) => {
                const checked = selected.has(it.key);
                const inputId = `donut-pick-${localStorageKey}-${it.key}`;
                return (
                  <li
                    key={it.key}
                    className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-accent"
                  >
                    <input
                      id={inputId}
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(it.key)}
                      className="h-4 w-4 cursor-pointer"
                    />
                    {it.color && (
                      <span
                        aria-hidden="true"
                        className="inline-block h-3 w-3 rounded-sm shrink-0"
                        style={{ background: it.color }}
                      />
                    )}
                    <label
                      htmlFor={inputId}
                      className="text-sm cursor-pointer flex-1 truncate"
                    >
                      {it.label}
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Read-only companion hook: returns the SELECTED set for the same
 * localStorage key as a `DonutEntityPicker`. The donut's data-filter
 * step calls this to decide which slices to render.
 *
 * Internally reuses `useDonutSelection` so the picker and the consumer
 * stay in lockstep without inter-component coupling — each owns its
 * own `useState` but both hydrate from the same localStorage entry,
 * and both write back via the same `useEffect`.
 */
export function useDonutSelected(
  localStorageKey: string,
  allKeys: ReadonlyArray<string>,
): Set<string> {
  return useDonutSelection(localStorageKey, allKeys).selected;
}
