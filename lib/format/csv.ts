/**
 * RFC-4180 CSV parser for the planner-cleaned import files (P50/P52):
 * UTF-8 BOM tolerated, CRLF tolerated, quoted cells with embedded commas /
 * escaped quotes ("") / embedded newlines supported — the real patient
 * files quote their comma-carrying headers and multi-select answers.
 * Dependency-free so import scripts and tests can use it without dragging
 * server-only chains. A ragged row is an error, not a guess.
 */

function parseRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;
  const push = () => {
    record.push(cell);
    cell = '';
  };
  const endRecord = () => {
    push();
    // Skip records that are entirely empty (trailing newline artifacts).
    if (record.length > 1 || record[0]!.trim() !== '') records.push(record);
    record = [];
  };
  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && cell === '') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      push();
      i += 1;
      continue;
    }
    if (ch === '\n') {
      endRecord();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      if (text[i + 1] === '\n') i += 1;
      endRecord();
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  if (cell !== '' || record.length > 0) endRecord();
  return records;
}

export function parseCsv(raw: string): Array<Record<string, string>> {
  const text = raw.replace(/^﻿/, '');
  const records = parseRecords(text);
  if (records.length < 2) return [];
  const headers = records[0]!.map((h) => h.trim());
  return records.slice(1).map((cells, i) => {
    if (cells.length !== headers.length) {
      throw new Error(`CSV row ${i + 2} has ${cells.length} cells, expected ${headers.length}`);
    }
    return Object.fromEntries(headers.map((h, j) => [h, cells[j]!.trim()]));
  });
}
