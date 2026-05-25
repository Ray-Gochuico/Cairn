import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useScenariosStore } from '@/stores/scenarios-store';
import { useLoansStore } from '@/stores/loans-store';
import { summarizeLevers } from '@/lib/whatif/lever-summary';
import { RenameScenarioDialog } from './RenameScenarioDialog';
import { SaveCurrentDialog } from './SaveCurrentDialog';
import type { Milestones } from '@/lib/scenarios';

interface ManageScenariosModalProps {
  milestones: Map<number, Milestones>;
  onClose: () => void;
  onEditLevers?: (scenarioId: number) => void;
}

function fmtMilestone(iso?: string): string {
  return iso ?? '—';
}

function fmtCurrency(n?: number): string {
  if (n == null) return '—';
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

export function ManageScenariosModal({
  milestones,
  onClose,
  onEditLevers,
}: ManageScenariosModalProps) {
  const { scenarios, duplicate, remove } = useScenariosStore();
  const { loans } = useLoansStore();

  const loanNames = useMemo(
    () =>
      Object.fromEntries(loans.map((l) => [l.id, l.name] as const)) as Record<number, string>,
    [loans],
  );

  const [renameTarget, setRenameTarget] = useState<{ id: number; name: string } | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const userScenarioCount = scenarios.filter((s) => !s.isBaseline).length;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Manage scenarios</DialogTitle>
        </DialogHeader>
        <div className="py-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b">
                <th className="py-1 pr-2">Name</th>
                <th className="py-1 pr-2">Levers Applied</th>
                <th className="py-1 pr-2">Debt-free</th>
                <th className="py-1 pr-2">FI</th>
                <th className="py-1 pr-2">30y NW</th>
                <th className="py-1 pr-2 w-44">Actions</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map((s) => {
                const ms = s.id != null ? milestones.get(s.id) : undefined;
                return (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="py-2 pr-2 align-top">
                      <span
                        className="inline-block w-2 h-2 rounded-full mr-2 align-middle"
                        style={{ backgroundColor: s.color }}
                      />
                      <span className="font-medium">{s.name}</span>
                      {s.isBaseline && (
                        <span className="ml-1 text-[10px] uppercase text-muted-foreground">
                          baseline
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-2 align-top text-xs">
                      {summarizeLevers(s.leverPayload, { loanNames })}
                    </td>
                    <td className="py-2 pr-2 align-top">{fmtMilestone(ms?.debtFreeISO)}</td>
                    <td className="py-2 pr-2 align-top">{fmtMilestone(ms?.financialIndependenceISO)}</td>
                    <td className="py-2 pr-2 align-top tabular-nums">
                      {fmtCurrency(ms?.netWorth30y)}
                    </td>
                    <td className="py-2 pr-2 align-top">
                      <div className="flex gap-1 flex-wrap">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => {
                            if (s.id != null) setRenameTarget({ id: s.id, name: s.name });
                          }}
                        >
                          Rename
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => s.id != null && void duplicate(s.id)}
                        >
                          Duplicate
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => {
                            if (s.id != null) onEditLevers?.(s.id);
                            onClose();
                          }}
                        >
                          Edit Levers
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-destructive"
                          disabled={s.isBaseline}
                          onClick={() => {
                            if (s.isBaseline) return;
                            if (s.id != null) void remove(s.id);
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <DialogFooter className="flex justify-between sm:justify-between">
          <Button variant="outline" onClick={() => setNewOpen(true)}>
            + New scenario
          </Button>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>

        {renameTarget && (
          <RenameScenarioDialog
            scenarioId={renameTarget.id}
            initialName={renameTarget.name}
            onClose={() => setRenameTarget(null)}
          />
        )}
        {newOpen && (
          <SaveCurrentDialog
            defaultName={`Scenario ${userScenarioCount + 1}`}
            onClose={() => setNewOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export default ManageScenariosModal;
