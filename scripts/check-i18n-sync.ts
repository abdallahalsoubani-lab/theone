#!/usr/bin/env tsx
/**
 * Translation-key parity check (Prompt 0 §5 rule 2, Prompt 3 §4.11).
 *
 * Walks `messages/en.json` and `messages/ar.json` and verifies that the set of
 * dotted key paths matches exactly. Exits non-zero with a human-readable diff
 * on mismatch so the GitHub Actions log surfaces the problem at a glance.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Catalog = unknown;

function loadCatalog(name: string): Catalog {
  const path = resolve(process.cwd(), 'messages', `${name}.json`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function collectKeys(value: Catalog, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix];
  const keys: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const next = prefix ? `${prefix}.${k}` : k;
    keys.push(...collectKeys(v, next));
  }
  return keys;
}

function diff(a: ReadonlySet<string>, b: ReadonlySet<string>): string[] {
  return [...a].filter((key) => !b.has(key)).sort();
}

function main(): void {
  const en = new Set(collectKeys(loadCatalog('en')));
  const ar = new Set(collectKeys(loadCatalog('ar')));

  const missingInAr = diff(en, ar);
  const missingInEn = diff(ar, en);

  if (missingInAr.length === 0 && missingInEn.length === 0) {
    console.log(`[i18n] en + ar in sync — ${en.size} keys.`);
    return;
  }

  console.error('[i18n] message catalogs are OUT OF SYNC');
  if (missingInAr.length > 0) {
    console.error(`\n  Missing in messages/ar.json (${missingInAr.length}):`);
    for (const k of missingInAr) console.error(`    - ${k}`);
  }
  if (missingInEn.length > 0) {
    console.error(`\n  Missing in messages/en.json (${missingInEn.length}):`);
    for (const k of missingInEn) console.error(`    - ${k}`);
  }
  console.error('\nAdd the missing keys (with real translations) and re-run pnpm i18n:check.');
  process.exit(1);
}

main();
