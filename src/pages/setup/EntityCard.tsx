import { useState, type ReactNode } from 'react';
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
}

export default function EntityCard({
  title,
  description,
  count,
  onAddManual,
  importEnabled,
  importTrigger,
}: Props) {
  const [skipped, setSkipped] = useState(false);

  if (skipped) {
    return (
      <div className="flex items-center justify-between px-3 py-2 rounded border bg-muted/30 text-sm text-muted-foreground">
        <span>{title} (skipped)</span>
        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={() => setSkipped(false)}
        >
          Un-skip
        </Button>
      </div>
    );
  }

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
          {importEnabled && importTrigger ? (
            <span>{importTrigger}</span>
          ) : (
            <Button type="button" variant="outline" disabled>
              Import CSV (coming soon)
            </Button>
          )}
          {count === 0 && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setSkipped(true)}
            >
              Skip — I don&apos;t have any
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
