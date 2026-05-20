import * as pdfjsLib from 'pdfjs-dist';
// Vite resolves `?url` to the emitted worker asset path. If Task 1 Step 2
// found a different filename, change it here to match.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PdfTextItem } from './types';
import { installReadableStreamAsyncIterator } from './readable-stream-async-iterator';

// WebKit (the macOS WKWebView Tauri uses) lacks ReadableStream async
// iteration, which pdfjs's getTextContent() relies on. Install the shim
// before any extraction runs.
installReadableStreamAsyncIterator();
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Extract every positioned text run from a PDF's bytes.
 *
 * This is the ONLY module that touches pdfjs. Everything downstream
 * (detection, parsers) is pure over `PdfTextItem[]` and fully testable.
 */
export async function extractTextItems(bytes: Uint8Array): Promise<PdfTextItem[]> {
  const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
  const out: PdfTextItem[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      for (const item of content.items) {
        // content.items holds TextItem | TextMarkedContent; only TextItem has `str`.
        if (!('str' in item)) continue;
        const t = item.transform as number[]; // [a,b,c,d,e,f]; e=x, f=y(baseline)
        out.push({
          page: p,
          str: item.str,
          x: t[4],
          y: viewport.height - t[5],
          width: item.width,
          height: item.height,
        });
      }
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return out;
}
