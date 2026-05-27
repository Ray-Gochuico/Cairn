import { useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useSettingsStore } from '@/stores/settings-store';
import { DEFAULT_SECTIONS } from '@/components/layout/Sidebar';
import { applySidebarLayout } from '@/lib/sidebar-layout';
import type { SidebarLayoutEntry } from '@/types/schema';

// The one tab the user must never be able to hide — losing it strands them
// with no route back into Settings to un-hide anything.
const NON_HIDEABLE = '/settings';

export function SidebarSection() {
  const settings = useSettingsStore((s) => s.settings);
  const load = useSettingsStore((s) => s.load);
  const update = useSettingsStore((s) => s.update);

  useEffect(() => {
    void load();
  }, [load]);

  // The displayed grouping reflects the current overlay (hidden tabs sink
  // out, the rest sort by overlay order), but hidden tabs must still be
  // listed here so the user can un-hide them — so we render against a
  // layout that has every tab visible, only carrying the order.
  const displaySections = useMemo(() => {
    const order = settings?.sidebarLayout ?? null;
    const visibleOnlyOrder = order
      ? order.map((e) => ({ to: e.to, hidden: false }))
      : null;
    return applySidebarLayout(DEFAULT_SECTIONS, visibleOnlyOrder);
  }, [settings?.sidebarLayout]);

  const hiddenSet = useMemo(
    () =>
      new Set(
        (settings?.sidebarLayout ?? [])
          .filter((e) => e.hidden)
          .map((e) => e.to),
      ),
    [settings?.sidebarLayout],
  );

  // Build a fresh overlay from the current display order, then hand the
  // caller a chance to mutate it before it is persisted.
  const writeLayout = (
    mutate: (entries: SidebarLayoutEntry[]) => SidebarLayoutEntry[],
  ) => {
    const flat: SidebarLayoutEntry[] = displaySections.flatMap((section) =>
      section.items.map((item) => ({
        to: item.to,
        hidden: hiddenSet.has(item.to),
      })),
    );
    void update({ sidebarLayout: mutate(flat) });
  };

  const toggleHidden = (to: string) => {
    writeLayout((entries) =>
      entries.map((e) => (e.to === to ? { ...e, hidden: !e.hidden } : e)),
    );
  };

  // Swap a tab with its neighbour, but only within its own section group —
  // cross-section moves are out of scope.
  const move = (sectionIndex: number, itemIndex: number, delta: -1 | 1) => {
    const section = displaySections[sectionIndex];
    const target = itemIndex + delta;
    if (target < 0 || target >= section.items.length) return;
    const sectionTos = section.items.map((i) => i.to);
    [sectionTos[itemIndex], sectionTos[target]] = [
      sectionTos[target],
      sectionTos[itemIndex],
    ];
    writeLayout((entries) => {
      const bySection = new Set(section.items.map((i) => i.to));
      const reorderedForSection = sectionTos.map((to) => ({
        to,
        hidden: hiddenSet.has(to),
      }));
      // Splice the reordered section back into the flat overlay in place.
      const result: SidebarLayoutEntry[] = [];
      let cursor = 0;
      for (const entry of entries) {
        if (bySection.has(entry.to)) {
          result.push(reorderedForSection[cursor]);
          cursor += 1;
        } else {
          result.push(entry);
        }
      }
      return result;
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sidebar</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-3">
          Hide tabs you don't use, or reorder them within a section.
        </p>
        <div className="space-y-4">
          {displaySections.map((section, sectionIndex) => (
            <div key={section.label}>
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                {section.label}
              </div>
              <ul className="space-y-1">
                {section.items.map((item, itemIndex) => {
                  const isHidden = hiddenSet.has(item.to);
                  const isLocked = item.to === NON_HIDEABLE;
                  const Icon = item.icon;
                  return (
                    <li
                      key={item.to}
                      className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span
                        className={
                          isHidden
                            ? 'flex-1 text-muted-foreground line-through'
                            : 'flex-1'
                        }
                      >
                        {item.label}
                      </span>
                      <button
                        type="button"
                        aria-label={`Move ${item.label} up`}
                        className="px-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
                        disabled={itemIndex === 0}
                        onClick={() => move(sectionIndex, itemIndex, -1)}
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${item.label} down`}
                        className="px-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
                        disabled={itemIndex === section.items.length - 1}
                        onClick={() => move(sectionIndex, itemIndex, 1)}
                      >
                        ▼
                      </button>
                      <button
                        type="button"
                        aria-label={`Hide ${item.label}`}
                        className="px-2 text-xs border rounded hover:bg-muted disabled:opacity-30"
                        disabled={isLocked}
                        onClick={() => toggleHidden(item.to)}
                      >
                        {isHidden ? 'Show' : 'Hide'}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
