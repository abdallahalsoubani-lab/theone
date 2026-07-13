import zlib from 'node:zlib';

/**
 * Test-only PDF text recovery (shared by report-privacy.test.ts and
 * pdf-arabic.test.ts — not a test file itself).
 *
 * Since the PDFs embed a subsetted TrueType font (Prompt 22 QA §2.4), the
 * content-stream `<hex>` strings inside TJ/Tj operators are 2-byte GLYPH IDs,
 * not WinAnsi bytes — recovering the visible text requires translating them
 * through each embedded font's /ToUnicode CMap. pdfkit writes those CMaps as
 * `beginbfchar` pairs and array-form `beginbfrange` blocks
 * (`<lo> <hi> [<dst> <dst> …]` with UTF-16BE destinations, multi-code-unit
 * for ligatures such as lam-alef).
 *
 * Caveat for assertions: the renderer's bidi engine stores RTL runs in
 * VISUAL order, so a recovered Arabic word may appear reversed relative to
 * its logical order — use {@link containsWordEitherDirection}.
 */

/** Inflate every `stream … endstream` body in the buffer (latin1 text). */
function extractStreams(buf: Buffer): string[] {
  const streams: string[] = [];
  const marker = Buffer.from('stream');
  const endMarker = Buffer.from('endstream');
  let idx = 0;
  while ((idx = buf.indexOf(marker, idx)) !== -1) {
    let start = idx + marker.length;
    if (buf[start] === 0x0d) start++;
    if (buf[start] === 0x0a) start++;
    const end = buf.indexOf(endMarker, start);
    if (end === -1) break;
    const slice = buf.subarray(start, end);
    try {
      streams.push(zlib.inflateSync(slice).toString('latin1'));
    } catch {
      try {
        streams.push(zlib.inflateRawSync(slice).toString('latin1'));
      } catch {
        streams.push(slice.toString('latin1')); // uncompressed stream
      }
    }
    idx = end + endMarker.length;
  }
  return streams;
}

/** Decode a UTF-16BE hex run (`<06440627>` → 'لا') into a JS string. */
function utf16beHexToString(hex: string): string {
  let out = '';
  for (let i = 0; i + 4 <= hex.length; i += 4) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
  }
  return out;
}

/** Parse a ToUnicode CMap stream into glyphId → unicode text. */
function parseToUnicodeCMap(stream: string): Map<number, string> | null {
  if (!stream.includes('beginbfchar') && !stream.includes('beginbfrange')) return null;
  const map = new Map<number, string>();
  for (const block of stream.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const entry of (block[1] ?? '').matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) {
      const dst = utf16beHexToString(entry[2] ?? '');
      if (dst) map.set(parseInt(entry[1] ?? '0', 16), dst);
    }
  }
  for (const block of stream.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    // Array form (what pdfkit emits): <lo> <hi> [<dst> <dst> …]
    for (const entry of (block[1] ?? '').matchAll(
      /<([0-9A-Fa-f]+)>\s*<[0-9A-Fa-f]+>\s*\[((?:\s*<[0-9A-Fa-f]*>)+)\s*\]/g,
    )) {
      const lo = parseInt(entry[1] ?? '0', 16);
      const dsts = [...(entry[2] ?? '').matchAll(/<([0-9A-Fa-f]*)>/g)].map((m) =>
        utf16beHexToString(m[1] ?? ''),
      );
      dsts.forEach((dst, i) => {
        if (dst) map.set(lo + i, dst);
      });
    }
  }
  return map.size > 0 ? map : null;
}

/** All glyph-id runs shown by TJ/Tj operators, one hex string per text run. */
function extractGlyphRuns(stream: string): string[] {
  if (!stream.includes('TJ') && !stream.includes('Tj')) return [];
  const runs: string[] = [];
  // TJ arrays: join the hex strings inside one array (kerning adjustments
  // may split a single word into several hex strings).
  for (const m of stream.matchAll(/\[((?:<[0-9A-Fa-f]*>|[^\][])*)\]\s*TJ/g)) {
    const joined = [...(m[1] ?? '').matchAll(/<([0-9A-Fa-f]*)>/g)].map((h) => h[1] ?? '').join('');
    if (joined) runs.push(joined);
  }
  for (const m of stream.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
    if (m[1]) runs.push(m[1]);
  }
  return runs;
}

/** Translate a glyph-id hex run through one font's ToUnicode map. */
function decodeGlyphRun(hex: string, cmap: Map<number, string>): string {
  let out = '';
  for (let i = 0; i + 4 <= hex.length; i += 4) {
    out += cmap.get(parseInt(hex.slice(i, i + 4), 16)) ?? '';
  }
  return out;
}

/**
 * All recoverable text from a PDF buffer: raw bytes (metadata + object
 * dictionaries), inflated streams, and every content-stream glyph run
 * decoded through every embedded font's ToUnicode CMap. Glyph ids overlap
 * between the embedded regular/bold subsets, so each run is decoded through
 * each CMap — the wrong pairing yields harmless noise, the right one yields
 * the visible text. Sufficient for `toContain` / `not.toContain` assertions.
 */
export function extractPdfText(buf: Buffer): string {
  const streams = extractStreams(buf);
  const cmaps = streams.map(parseToUnicodeCMap).filter((m): m is Map<number, string> => m !== null);
  const runs = streams.flatMap(extractGlyphRuns);
  const decoded = runs.flatMap((run) => cmaps.map((cmap) => decodeGlyphRun(run, cmap)));
  return buf.toString('latin1') + streams.join('\n') + '\n' + decoded.join('\n');
}

/**
 * True if the extracted text contains the word in logical OR visual
 * (reversed) order — RTL runs are stored in visual order in the content
 * stream. Use ligature-free Arabic words (no ل followed by ا/أ/إ/آ) so the
 * reversal check stays exact.
 */
export function containsWordEitherDirection(text: string, word: string): boolean {
  return text.includes(word) || text.includes([...word].reverse().join(''));
}
