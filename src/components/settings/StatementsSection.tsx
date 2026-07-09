import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useSettingsStore } from '@/stores/settings-store';

/**
 * Statements archive settings. Picks the folder confirmed PDF imports are
 * copied into. The native folder picker (`@tauri-apps/plugin-dialog` `open`)
 * is impure and only exercised by the user's smoke test — component tests
 * seed `useSettingsStore` directly and never click "Choose folder…".
 */
export function StatementsSection() {
  const settings = useSettingsStore((s) => s.settings);
  const load = useSettingsStore((s) => s.load);
  const update = useSettingsStore((s) => s.update);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (settings === null) void load();
  }, [settings, load]);

  const folder = settings?.statementsFolderPath ?? null;

  const handleChoose = async () => {
    setError(null);
    try {
      const picked = await open({ directory: true, multiple: false });
      // `open` returns string | string[] | null; with multiple:false it is
      // string | null. A null result means the user cancelled the dialog.
      if (typeof picked === 'string') {
        await update({ statementsFolderPath: picked });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleClear = async () => {
    setError(null);
    try {
      await update({ statementsFolderPath: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="font-semibold leading-none tracking-tight">Statements</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Confirmed statement imports are copied into this folder, building a
          persistent archive. Optional — leave it unset to skip archiving.
        </p>
        <div className="text-sm">
          <span className="text-muted-foreground">Archive folder: </span>
          {folder ? (
            <span className="font-mono break-all">{folder}</span>
          ) : (
            <span className="italic text-muted-foreground">No folder selected</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleChoose}>
            Choose folder…
          </Button>
          {folder && (
            <Button variant="ghost" onClick={handleClear}>
              Clear
            </Button>
          )}
        </div>
        {error && (
          <p className="text-sm text-destructive-soft-foreground" role="alert">{error}</p>
        )}
      </CardContent>
    </Card>
  );
}
