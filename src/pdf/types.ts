/**
 * Shared types for the PDF pipeline. Deliberately free of any pdfjs import
 * so parsers, layout helpers, and their tests never load pdfjs — only
 * `extract.ts` does. `ParsedTransaction` is added in Slice 2 (Task 5).
 */

/**
 * One positioned text run extracted from a PDF.
 *
 * `y` is normalized **top-down** (0 = page top) — pdfjs natively reports a
 * baseline measured from the page bottom; `extractTextItems` flips it so
 * "earlier in reading order = smaller y", which every parser relies on.
 */
export interface PdfTextItem {
  page: number; // 1-based
  str: string;
  x: number; // left edge, PDF points
  y: number; // top edge, PDF points, 0 = page top
  width: number;
  height: number;
}
