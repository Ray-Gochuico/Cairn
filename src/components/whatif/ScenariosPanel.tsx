import { useEffect, useMemo, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useScenariosStore } from '@/stores/scenarios-store';
import { SaveCurrentDialog } from './SaveCurrentDialog';
import { RenameScenarioDialog } from './RenameScenarioDialog';
import type { Milestones } from '@/lib/scenarios';

interface ScenariosPanelProps {
  milestones: Map<number, Milestones>;
  onOpenManage: () => void;
  onEditLevers?: (scenarioId: number) => void;
}

function formatMilestone(iso?: string): string {
  return iso ? iso.replace('-', '/') : '—';
}

export function ScenariosPanel({
  milestones,
  onOpenManage,
  onEditLevers,
}: ScenariosPanelProps) {
  const store = useScenariosStore();
  const { scenarios, toggleVisibility, setActive, duplicate, remove } = store;
  const active = store.activeScenario();
  const visibleIds = store.visibleScenarioIds();

  const [saveOpen, setSaveOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: number; name: string } | null>(null);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const menuRootRef = useRef<HTMLDivElement | null>(null);

  const userScenarioCount = useMemo(
    () => scenarios.filter((s) => !s.isBaseline).length,
    [scenarios],
  );

  useEffect(() => {
    if (openMenuId == null) return;
    function onDocClick(e: MouseEvent) {
      if (!menuRootRef.current) return;
      if (e.target instanceof Node && menuRootRef.current.contains(e.target)) return;
      setOpenMenuId(null);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [openMenuId]);

  return (
    <div
      ref={menuRootRef}
      className="absolute top-3 right-3 w-[220px] rounded-md border bg-card/95 backdrop-blur p-2 shadow-md"
    >
      <ul className="space-y-1">
        {scenarios.map((s) => {
          const isActive = active?.id === s.id;
          const ms = s.id != null ? milestones.get(s.id) : undefined;
          const isVisible = s.id != null ? visibleIds.includes(s.id) : false;
          const menuOpen = openMenuId === s.id;
          return (
            <li
              key={s.id}
              data-row-id={s.id}
              className="flex items-center gap-2 px-1 py-1 rounded hover:bg-accent/40 relative"
            >
              <input
                type="checkbox"
                checked={isVisible}
                onChange={() => s.id != null && void toggleVisibility(s.id)}
                aria-label={`Toggle visibility of ${s.name}`}
                className="h-3.5 w-3.5"
              />
              <span
                aria-label={`Color swatch ${s.color}`}
                className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: s.color }}
              />
              <button
                type="button"
                onClick={() => s.id != null && void setActive(s.id)}
                className="flex-1 text-left text-sm leading-tight truncate"
                title={s.name}
              >
                <span className="font-medium">{s.name}</span>
                {isActive && (
                  <span className="ml-1 text-[10px] uppercase text-muted-foreground">
                    active
                  </span>
                )}
                <div className="text-[10px] text-muted-foreground truncate">
                  Debt-free {formatMilestone(ms?.debtFreeISO)} · FI{' '}
                  {formatMilestone(ms?.financialIndependenceISO)}
                </div>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="More actions"
                className="h-6 w-6"
                onClick={() => setOpenMenuId(menuOpen ? null : (s.id ?? null))}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-1 top-7 z-10 w-40 rounded-md border bg-popover shadow-md py-1"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="block w-full text-left px-3 py-1.5 text-xs hover:bg-accent"
                    onClick={() => {
                      if (s.id != null) setRenameTarget({ id: s.id, name: s.name });
                      setOpenMenuId(null);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="block w-full text-left px-3 py-1.5 text-xs hover:bg-accent"
                    onClick={() => {
                      if (s.id != null) void duplicate(s.id);
                      setOpenMenuId(null);
                    }}
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="block w-full text-left px-3 py-1.5 text-xs hover:bg-accent"
                    onClick={() => {
                      if (s.id != null) onEditLevers?.(s.id);
                      setOpenMenuId(null);
                    }}
                  >
                    Edit Levers
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    aria-disabled={s.isBaseline}
                    disabled={s.isBaseline}
                    className="block w-full text-left px-3 py-1.5 text-xs text-destructive hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => {
                      if (s.isBaseline) return;
                      if (s.id != null) void remove(s.id);
                      setOpenMenuId(null);
                    }}
                  >
                    Delete
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex justify-between gap-1 pt-2 border-t mt-2">
        <Button
          size="sm"
          variant="outline"
          className="flex-1 text-xs h-7"
          onClick={() => setSaveOpen(true)}
        >
          + Save current
        </Button>
        <Button size="sm" variant="ghost" className="text-xs h-7" onClick={onOpenManage}>
          Manage…
        </Button>
      </div>

      {saveOpen && (
        <SaveCurrentDialog
          defaultName={`Scenario ${userScenarioCount + 1}`}
          onClose={() => setSaveOpen(false)}
        />
      )}

      {renameTarget && (
        <RenameScenarioDialog
          scenarioId={renameTarget.id}
          initialName={renameTarget.name}
          onClose={() => setRenameTarget(null)}
        />
      )}
    </div>
  );
}

export default ScenariosPanel;
