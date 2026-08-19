/**
 * Dependency-free XLSX reader for the P50 roster import (scripts only).
 *
 * Why not a library: the stack is intentionally tight (CLAUDE.md — no new
 * npm dependencies without justification) and the one consumer is a one-off
 * import script. The owner-reviewed workbook is the single source of truth
 * and must be read byte-for-byte — a manual "export to CSV" step would
 * reintroduce exactly the transcription risk the review eliminated.
 *
 * Scope (deliberately narrow, verified against the actual review workbook):
 *   - ZIP: stored (0) and deflate (8) entries, read via the central directory
 *   - Shared strings (`t="s"`), inline strings (`t="inlineStr"`), formula
 *     strings (`t="str"`), and raw numeric cells (returned as their string
 *     representation — the roster sheet is 100% text cells)
 *   - Multi-run strings (`<si>` with several `<t>` runs), `xml:space`,
 *     entity decoding
 *
 * NOT supported (throws or ignores): encrypted workbooks, ZIP64, date-styled
 * numeric cells (the roster stores dates as ISO text), formulas evaluation.
 */

import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

// ─── ZIP ───────────────────────────────────────────────────────────────────

function unzip(buf: Buffer): Map<string, Buffer> {
  // End-of-central-directory: scan backward for PK\x05\x06.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('xlsx-lite: not a ZIP file (no end-of-central-directory)');
  const entryCount = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);

  const files = new Map<string, Buffer>();
  for (let n = 0; n < entryCount; n++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('xlsx-lite: corrupt central directory');
    }
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');

    // Local header carries its own (possibly different) extra-field length.
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) files.set(name, Buffer.from(raw));
    else if (method === 8) files.set(name, inflateRawSync(raw));
    else throw new Error(`xlsx-lite: unsupported compression method ${method} for ${name}`);

    offset += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

// ─── XML helpers (regex-scoped to the small, predictable OOXML subset) ─────

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Concatenate every `<t>` run inside a fragment (rich-text strings). */
function textRuns(fragment: string): string {
  let out = '';
  for (const m of fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g))
    out += decodeEntities(m[1]!);
  return out;
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const strings: string[] = [];
  for (const m of xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)) strings.push(textRuns(m[1]!));
  return strings;
}

function colIndex(ref: string): number {
  let idx = 0;
  for (const ch of ref) {
    if (ch < 'A' || ch > 'Z') break;
    idx = idx * 26 + (ch.charCodeAt(0) - 64);
  }
  return idx - 1;
}

function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const body = rowMatch[1] ?? '';
    const cells: string[] = [];
    for (const c of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]!;
      const inner = c[2] ?? '';
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
      if (!ref) continue;
      const t = /t="(\w+)"/.exec(attrs)?.[1];
      let value = '';
      if (t === 'inlineStr') {
        value = textRuns(inner);
      } else {
        const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        if (v !== undefined) {
          value = t === 's' ? (shared[Number(v)] ?? '') : decodeEntities(v);
        }
      }
      cells[colIndex(ref)] = value;
    }
    // Dense row: fill holes with ''.
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
    rows.push(cells);
  }
  return rows;
}

// ─── Workbook assembly ─────────────────────────────────────────────────────

export function parseXlsx(buf: Buffer): Map<string, string[][]> {
  const files = unzip(buf);
  const text = (name: string): string | undefined => files.get(name)?.toString('utf8');

  const workbook = text('xl/workbook.xml');
  if (!workbook) throw new Error('xlsx-lite: xl/workbook.xml missing');
  const rels = text('xl/_rels/workbook.xml.rels') ?? '';
  const relTarget = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    relTarget.set(m[1]!, m[2]!);
  }
  // Attribute order varies by writer (Target before Id in some producers).
  for (const m of rels.matchAll(/<Relationship\b[^>]*Target="([^"]+)"[^>]*Id="([^"]+)"/g)) {
    if (!relTarget.has(m[2]!)) relTarget.set(m[2]!, m[1]!);
  }

  const shared = parseSharedStrings(text('xl/sharedStrings.xml'));

  const sheets = new Map<string, string[][]>();
  for (const m of workbook.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"[^>]*\/>/g)) {
    const name = decodeEntities(m[1]!);
    const target = relTarget.get(m[2]!);
    if (!target) continue;
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    const xml = text(path);
    if (!xml) throw new Error(`xlsx-lite: worksheet ${path} missing for sheet "${name}"`);
    sheets.set(name, parseSheet(xml, shared));
  }
  return sheets;
}

export function readXlsx(path: string): Map<string, string[][]> {
  return parseXlsx(readFileSync(path));
}
