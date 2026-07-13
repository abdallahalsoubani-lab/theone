import { Text, pdf } from '@react-pdf/renderer';
import type { ComponentProps, ReactNode } from 'react';

import { purgePdfFontGlyphCache } from './fonts';

type PdfDocElement = Parameters<typeof pdf>[0];

/**
 * Unicode default-ignorable format characters: bidi controls (LRM/RLM/ALM,
 * embeddings, isolates), zero-width (non-)joiners, word joiner, BOM.
 *
 * Intl's `ar` date formatting wraps segments in U+200F (RLM), and free-text
 * patient data can carry any of these. They are invisible, carry no glyph in
 * IBM Plex Sans Arabic (typical for fonts), and react-pdf substitutes its
 * built-in Helvetica for glyph-less codepoints — re-embedding the very font
 * that cannot render Arabic and showing a stray .notdef. They are also
 * useless inside the PDF: react-pdf runs its own UAX#9 bidi pass driven by
 * the explicit `direction` style. So strip them from every text node.
 * (Tradeoff: ZWNJ is meaningful for Persian-style joining suppression; a
 * stray box for every Arabic date is the far worse failure mode here.)
 */
const DEFAULT_IGNORABLES = /[\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

function stripDefaultIgnorables(node: ReactNode): ReactNode {
  if (typeof node === 'string') return node.replace(DEFAULT_IGNORABLES, '');
  if (Array.isArray(node)) return node.map((child) => stripDefaultIgnorables(child));
  return node;
}

/**
 * Drop-in replacement for react-pdf's <Text> that strips default-ignorable
 * characters from its children. Every PDF renderer in lib/exports/ MUST use
 * this instead of the raw <Text> — the pdf-arabic smoke tests fail on any
 * document that lets an RLM through to the Helvetica fallback.
 */
export function PdfText({
  children,
  ...rest
}: ComponentProps<typeof Text> & { children?: ReactNode }) {
  return <Text {...rest}>{stripDefaultIgnorables(children)}</Text>;
}

/**
 * Render a react-pdf document element to a complete Buffer — the single
 * render path shared by all four PDF generators (patient file, pediatric
 * assessment, session report, treatment plan).
 *
 * Purges the registered fonts' glyph caches first: embedding one document's
 * font subset poisons the shared fontkit instance and would crash the next
 * Arabic render in the same process (see purgePdfFontGlyphCache in fonts.ts
 * for the full story).
 *
 * react-pdf's `toBuffer()` actually returns a Node Readable stream; collect
 * it into a single Buffer before handing to the route handler.
 */
export async function renderPdfToBuffer(element: PdfDocElement): Promise<Buffer> {
  purgePdfFontGlyphCache();
  const stream = await pdf(element).toBuffer();
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    (stream as unknown as NodeJS.ReadableStream).on('data', (c: Buffer) => chunks.push(c));
    (stream as unknown as NodeJS.ReadableStream).on('end', () => resolve());
    (stream as unknown as NodeJS.ReadableStream).on('error', reject);
  });
  return Buffer.concat(chunks);
}
