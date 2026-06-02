import { type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface Props {
  title: string;
  description: string;
  count: number;
  onAddManual: () => void;
  /**
   * When true and `importTrigger` is provided, renders the import trigger
   * instead of the disabled placeholder. Used by N3/N4 to wire in
   * `ImportCsvButton`.
   */
  importEnabled?: boolean;
  /**
   * Pre-built import button (e.g. `<ImportCsvButton entity="account" />`).
   * Only rendered when importEnabled is true. The card supplies the
   * visual container; the trigger is yours.
   */
  importTrigger?: ReactNode;
  /**
   * When set, the import affordance is rendered DISABLED with this reason
   * shown inline beneath the buttons — used when a prerequisite entity is
   * empty (e.g. no accounts yet, so name-matching imports cannot resolve).
   * Takes precedence over importEnabled/importTrigger.
   */
  importDisabledReason?: string;
}

export default function EntityCard({
  title,
  description,
  count,
  onAddManual,
  importEnabled,
  importTrigger,
  importDisabledReason,
}: Props) {
  // Stable id so the disabled Import CSV button can point at its reason note
  // via aria-describedby (L1) — a keyboard user tabbing onto the dead button
  // gets the "why" instead of an unexplained disabled control.
  const reasonId = `entity-import-reason-${title.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          <span className="text-xs text-muted-foreground">
            {count} added
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{description}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={onAddManual}>
            Add manually
          </Button>
          {importDisabledReason ? (
            <Button
              type="button"
              variant="outline"
              disabled
              aria-describedby={reasonId}
            >
              Import CSV
            </Button>
          ) : importEnabled && importTrigger ? (
            <span>{importTrigger}</span>
          ) : (
            // No CSV importer for this entity (e.g. housing / lease / asset
            // values / goals). Plain disabled state — not "coming soon", which
            // overpromised an importer that isn't planned for these.
            <Button type="button" variant="outline" disabled>
              Import CSV
            </Button>
          )}
        </div>
        {importDisabledReason && (
          <p id={reasonId} className="text-xs text-muted-foreground" role="note">
            {importDisabledReason}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
