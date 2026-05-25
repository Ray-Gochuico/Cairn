import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { AnnualTotalDialog } from './AnnualTotalDialog';
import { useAccountsStore } from '@/stores/accounts-store';
import { usePersonsStore } from '@/stores/persons-store';

export function AddAnnualTotalButton() {
  const [open, setOpen] = useState(false);
  const accounts = useAccountsStore((s) => s.accounts);
  const persons = usePersonsStore((s) => s.persons);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        + Annual total
      </Button>
      <AnnualTotalDialog
        open={open}
        onOpenChange={setOpen}
        accounts={accounts.filter((a): a is typeof a & { id: number } => a.id != null).map((a) => ({ id: a.id, name: a.name }))}
        persons={persons.filter((p): p is typeof p & { id: number } => p.id != null).map((p) => ({ id: p.id, name: p.name }))}
      />
    </>
  );
}
