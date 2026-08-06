import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export interface EntityCardItem {
  key: number | string;
  label: string;
  /** Renders a pencil button on the chip when provided. */
  onEdit?: () => void;
  /** Renders an X button on the chip when provided. May be async. */
  onRemove?: () => void | Promise<void>;
}

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
  /**
   * Created entities, rendered as a chip row below the buttons so the user
   * can SEE what they added (generalizes the v1.1.0 person-chips idiom).
   * Edit/remove buttons render only when the matching handler is provided.
   * An empty array renders nothing — counts stay the only empty-state signal.
   */
  items?: EntityCardItem[];
  /**
   * Override for the chip row's data-testid. Defaults to a slug of the
   * title (e.g. "Rent / housing payment" → "rent-housing-payment-chips").
   * Persons pass "person-chips" to keep the shipped e2e/test contract.
   */
  itemsTestId?: string;
  /** Wave C (N7/OB-G7): link to this entity's one-place-per-thing home —
   *  generalizes the shipped Section-4 "Manage on Spending page →". Both
   *  required together; absent = no link (keeps bare test renders router-free). */
  manageHref?: string;
  manageLabel?: string;
}

export default function EntityCard({
  title,
  description,
  count,
  onAddManual,
  importEnabled,
  importTrigger,
  importDisabledReason,
  items,
  itemsTestId,
  manageHref,
  manageLabel,
}: Props) {
  // Stable id so the disabled Import CSV button can point at its reason note
  // via aria-describedby (L1) — a keyboard user tabbing onto the dead button
  // gets the "why" instead of an unexplained disabled control.
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
  const reasonId = `entity-import-reason-${slug}`;
  const chipsTestId = itemsTestId ?? `${slug}-chips`;
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
        {items && items.length > 0 && (
          <div className="flex flex-wrap gap-2" data-testid={chipsTestId}>
            {items.map((item) => (
              <span
                key={item.key}
                className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-sm"
              >
                <span className="max-w-[14rem] truncate" title={item.label}>
                  {item.label}
                </span>
                {item.onEdit && (
                  <button
                    type="button"
                    aria-label={`Edit ${item.label}`}
                    className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                    onClick={item.onEdit}
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
                {item.onRemove && (
                  <button
                    type="button"
                    aria-label={`Remove ${item.label}`}
                    className="rounded-full p-0.5 text-muted-foreground hover:text-destructive-soft-foreground"
                    onClick={() => void item.onRemove?.()}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
        {manageHref && manageLabel && (
          <div className="flex justify-end">
            <Link to={manageHref} className="text-xs text-muted-foreground underline">
              {manageLabel} →
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
