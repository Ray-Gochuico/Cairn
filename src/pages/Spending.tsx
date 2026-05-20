import { useState } from 'react';
import { extractTextItems } from '@/pdf/extract';
import type { PdfTextItem } from '@/pdf/types';

export default function Spending() {
  const [items, setItems] = useState<PdfTextItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setItems(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const extracted = await extractTextItems(bytes);
      setItems(extracted);
      // eslint-disable-next-line no-console
      console.info('[pdf] extracted', extracted.length, 'items from', file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="p-8 space-y-4">
      <h1 className="text-2xl font-semibold">Spending</h1>
      <p className="text-muted-foreground">
        PDF import is being built in Phase 4. Below is a temporary extraction
        preview.
      </p>
      <input type="file" accept="application/pdf" onChange={handleFile} aria-label="Statement PDF" />
      {error && <p className="text-sm text-destructive">{error}</p>}
      {items && (
        <div className="text-sm">
          <p>
            Extracted <strong>{items.length}</strong> text items across{' '}
            <strong>{Math.max(...items.map((i) => i.page))}</strong> page(s).
          </p>
          <pre className="mt-2 max-h-80 overflow-auto rounded border bg-muted p-3 text-xs">
            {items
              .filter((i) => i.page === 1)
              .map((i) => i.str)
              .join(' ')
              .slice(0, 2000)}
          </pre>
        </div>
      )}
    </div>
  );
}
