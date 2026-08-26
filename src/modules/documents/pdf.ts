import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

/**
 * Minimal, dependency-appropriate PDF rendering used for every generated financial/legal document
 * (item 3). `pdf-lib` is a maintained, pure-JS, actively developed PDF library with no native
 * bindings, which keeps document generation portable across any Next.js deployment target.
 *
 * Real Ghanaian names, addresses, and currency notation routinely use characters outside
 * `pdf-lib`'s built-in Standard 14 fonts (Helvetica only covers WinAnsi/Latin-1) — e.g. ɛ/ɔ
 * (Akan/Twi open e/o) and ₵ (the Ghana cedi sign). Standard fonts throw at embed/draw time for
 * any character they don't cover, so every document is rendered with an embedded, subsettable
 * Unicode font (Noto Sans, bundled as a repo asset — never fetched from the OS or network at
 * runtime) via `@pdf-lib/fontkit`, which `pdf-lib` requires to embed non-Standard-14 fonts.
 */
const assetsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "assets", "fonts");
const NOTO_SANS_REGULAR_BYTES = readFileSync(path.join(assetsDir, "NotoSans-Regular.ttf"));
const NOTO_SANS_BOLD_BYTES = readFileSync(path.join(assetsDir, "NotoSans-Bold.ttf"));
export type DocumentSection = { heading?: string; rows: Array<{ label: string; value: string }> };
export type DocumentTable = { headers: string[]; columnWidths: number[]; rows: string[][] };

export type SimpleDocumentInput = {
  title: string;
  subtitle?: string;
  referenceNumber: string;
  issuedLabel: string;
  sections?: DocumentSection[];
  table?: DocumentTable;
  paragraphs?: string[];
  footerLines?: string[];
};

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;

export async function renderSimpleDocument(input: SimpleDocumentInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(input.title);
  pdf.setSubject(input.referenceNumber);
  // Fontkit is required by pdf-lib to embed any font beyond the built-in Standard 14 (Helvetica).
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(NOTO_SANS_REGULAR_BYTES, { subset: true });
  const bold = await pdf.embedFont(NOTO_SANS_BOLD_BYTES, { subset: true });

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const newPage = () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  };
  const ensureSpace = (needed: number) => {
    if (y - needed < MARGIN) newPage();
  };
  const text = (value: string, options: { size?: number; useFont?: PDFFont; color?: [number, number, number]; x?: number } = {}) => {
    const size = options.size ?? 10;
    ensureSpace(size + 4);
    page.drawText(value, {
      x: options.x ?? MARGIN,
      y,
      size,
      font: options.useFont ?? font,
      color: rgb(...(options.color ?? [0.1, 0.1, 0.12])),
    });
    y -= size + 6;
  };

  text(input.title, { size: 20, useFont: bold });
  if (input.subtitle) text(input.subtitle, { size: 11, color: [0.35, 0.4, 0.45] });
  text(`Reference: ${input.referenceNumber}`, { size: 9, color: [0.45, 0.45, 0.5] });
  text(input.issuedLabel, { size: 9, color: [0.45, 0.45, 0.5] });
  y -= 8;

  for (const paragraph of input.paragraphs ?? []) {
    for (const line of wrapText(paragraph, font, 10, PAGE_WIDTH - MARGIN * 2)) text(line, { size: 10 });
    y -= 4;
  }

  for (const section of input.sections ?? []) {
    if (section.heading) {
      y -= 4;
      text(section.heading, { size: 12, useFont: bold });
    }
    for (const row of section.rows) {
      ensureSpace(14);
      page.drawText(row.label, { x: MARGIN, y, size: 10, font: bold, color: rgb(0.25, 0.25, 0.3) });
      page.drawText(row.value, { x: MARGIN + 180, y, size: 10, font, color: rgb(0.1, 0.1, 0.12) });
      y -= 16;
    }
  }

  if (input.table) {
    y -= 10;
    ensureSpace(20);
    let x = MARGIN;
    for (const [index, header] of input.table.headers.entries()) {
      page.drawText(header, { x, y, size: 9, font: bold, color: rgb(0.2, 0.2, 0.25) });
      x += input.table.columnWidths[index] ?? 100;
    }
    y -= 6;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.75) });
    y -= 12;
    for (const row of input.table.rows) {
      ensureSpace(16);
      x = MARGIN;
      for (const [index, cell] of row.entries()) {
        page.drawText(cell, { x, y, size: 9, font, color: rgb(0.15, 0.15, 0.18) });
        x += input.table.columnWidths[index] ?? 100;
      }
      y -= 15;
    }
  }

  if (input.footerLines?.length) {
    y -= 14;
    for (const line of input.footerLines) text(line, { size: 8, color: [0.5, 0.5, 0.55] });
  }

  return pdf.save();
}

function wrapText(paragraph: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = paragraph.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Keep PDFPage type referenced so editors/type-checkers don't flag the imported-but-unused type
// if a future refactor narrows the public surface of this module.
export type { PDFPage };
