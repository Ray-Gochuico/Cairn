// @vitest-environment node
/**
 * v1.8.0 W4 (C009, MAJOR): pdf.js takes ownership of the array it is handed.
 * pdfjs-dist 5.7.284 posts a full-buffer Uint8Array to its worker with
 * [data.buffer] in the transfer list (build/pdf.mjs getDataProp and
 * GetDocRequest), which detaches the caller's array. The importer keeps that
 * same array for the statements archive, so every archived PDF was written
 * empty. extractTextItems must parse a copy and leave the caller's bytes whole.
 *
 * Runs the PRODUCTION src/pdf/extract.ts on the MAIN pdfjs-dist build (the one
 * the app ships) in node. The only shims: a DOMMatrix stub (the main build
 * constructs one at module load; text extraction never uses it) and
 * globalThis.pdfjsWorker set to the real build/pdf.worker.mjs, which pdf.js
 * runs in-thread over its LoopbackPort. That port structuredClone()s each
 * message WITH its transfer list, exactly as Worker.postMessage(msg, transfer)
 * does in WKWebView. Clock-free.
 *
 * pdfjs-dist 5.7.284 declares engines node >=22.13.0 || >=24 and calls
 * Promise.withResolvers, which older Node lacks. GitHub CI still runs Node 20,
 * so on CI below that floor the real-pdf.js proof is skipped, and the skip
 * names the floor. Anywhere else below the floor it fails, so the local gate
 * cannot pass without running the proof (ruling CL-W4L1-7).
 */
import { describe, expect, it } from 'vitest';

const PDFJS_NODE_FLOOR = '>=22.13.0 || >=24';

/** True when `version` (e.g. '22.13.0' or 'v22.13.0') meets pdfjs-dist's engines floor. */
function pdfjsSupportsNode(version: string): boolean {
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  if (major > 22) return true;
  return major === 22 && minor >= 13;
}

const NODE_VERSION = process.versions.node;
const ON_CI = process.env.CI === 'true';
const SUPPORTED = pdfjsSupportsNode(NODE_VERSION);

/** A one-page PDF whose only text run is `text` (Helvetica, 12 pt). */
function minimalPdf(text: string): Uint8Array {
  const objs: string[] = [];
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objs.push(
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
  );
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

describe('extractTextItems keeps the caller bytes whole (C009)', () => {
  it.skipIf(ON_CI && !SUPPORTED)(
    `parses the statement through pdf.js and leaves the array the importer archives untouched (needs Node ${PDFJS_NODE_FLOOR}; skipped on CI below it)`,
    async () => {
      if (!SUPPORTED) {
        throw new Error(
          `Node ${NODE_VERSION} is below pdfjs-dist's engines floor (${PDFJS_NODE_FLOOR}). Run the suite on a supported Node.`,
        );
      }
      const g = globalThis as Record<string, unknown>;
      if (typeof g.DOMMatrix === 'undefined') {
        g.DOMMatrix = class {
          constructor(_init?: unknown) {}
        };
      }
      g.pdfjsWorker = await import('pdfjs-dist/build/pdf.worker.mjs');
      const { extractTextItems } = await import('@/pdf/extract');

      // Built exactly as TransactionsSectionImporter builds it: a full-buffer view.
      const file = new File([minimalPdf('01/15 COFFEE SHOP 12.34')], 'stmt.pdf', {
        type: 'application/pdf',
      });
      const bytes = new Uint8Array(await file.arrayBuffer());
      const before = Array.from(bytes);
      expect(before.length).toBeGreaterThan(300);

      const items = await extractTextItems(bytes);

      // pdf.js really ran over the statement.
      expect(items.map((i) => i.str).join(' ')).toContain('COFFEE');
      // The caller's array still holds every byte of the PDF.
      expect(bytes.byteLength, 'caller bytes after extractTextItems').toBe(before.length);
      expect(Array.from(bytes)).toEqual(before);
    },
  );

  it(`pdfjsSupportsNode implements pdfjs-dist's engines floor (${PDFJS_NODE_FLOOR})`, () => {
    expect(pdfjsSupportsNode('20.19.5')).toBe(false);
    expect(pdfjsSupportsNode('22.12.0')).toBe(false);
    expect(pdfjsSupportsNode('22.13.0')).toBe(true);
    expect(pdfjsSupportsNode('23.1.0')).toBe(true);
    expect(pdfjsSupportsNode('24.0.0')).toBe(true);
    expect(pdfjsSupportsNode('25.9.0')).toBe(true);
  });
});
