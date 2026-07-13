#!/usr/bin/env tsx
/**
 * i18n gate (`pnpm i18n:check`) — two phases:
 *
 * 1. PARITY (Prompt 0 §5 rule 2, Prompt 3 §4.11): `messages/en.json` and
 *    `messages/ar.json` must contain the exact same set of dotted key paths.
 *
 * 2. USAGE (QA Prompt-22 §7.4): every statically-analyzable translation key
 *    referenced from code must exist in BOTH catalogs. The extractor binds
 *    translator variables to namespaces —
 *        const t = useTranslations('ns')
 *        const t = await getTranslations('ns')
 *        const t = await getTranslations({ locale, namespace: 'ns' })
 *    — then resolves literal calls `t('key')` / `t.rich('key')` / `t.raw(…)`
 *    / `t.markup(…)` / `t.has(…)` to `ns.key`. Pragmatic by design:
 *      - Dynamic keys (template literals with `${}`, variables) are skipped
 *        and only counted.
 *      - Comments are stripped first, so JSDoc usage examples don't count.
 *      - When one variable name is bound to several namespaces in a file,
 *        the key passes if it resolves under ANY of them; as a last resort
 *        it may resolve under any OTHER namespace bound in the same file
 *        (helpers that receive a differently-named translator as a
 *        parameter, e.g. describeConflict(c, tConflicts, locale)).
 *      - Known-good references the static pass cannot resolve correctly go
 *        in USAGE_ALLOWLIST below (exact key or `prefix.*`).
 *
 * `--self-test` runs the extractor against inline fixtures and exits.
 *
 * Exits non-zero with a human-readable report on any failure so the CI log
 * surfaces the problem at a glance.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

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

// ---------------------------------------------------------------------------
// Phase 2 — code-usage extraction
// ---------------------------------------------------------------------------

/**
 * Fully-qualified keys (or `prefix.*` wildcards) the usage phase must not
 * fail on. Keep every entry commented with a reason. This is the pressure
 * valve for the static extractor's known limits (shadowed variable names,
 * keys added in the same change-set by another workstream, …).
 */
const USAGE_ALLOWLIST: string[] = [
  // PENDING (QA Prompt-22 §7.4 first run): keys referenced in code but not
  // yet present in the catalogs — reported for addition in the same QA
  // change-set. REMOVE each entry once the key lands in both catalogs.
  'publicIntake.fullNameAr',
  'publicIntake.fullNameEn',
  'publicIntake.languagePref',
  'clinical.homeProgram.approval.draftRevisionNote',
  'calendar.series.closedDay',
  'calendar.series.weekdayMaxHint',
  'calendar.series.hardBlockedHint',
  'clinical.plans.editTitle',
  'clinical.plans.editSubtitle',
  'clinical.plans.saveChanges',
  'clinical.homeProgram.emptyTab',
];

/** Directories scanned for translator usage, relative to the repo root. */
const SCAN_DIRS = ['app', 'components', 'lib', 'workers'] as const;
const SOURCE_FILE_RE = /\.(?:ts|tsx)$/;
const SKIP_DIRS = new Set(['node_modules', '__tests__', '.next', 'e2e']);

/** `const t = useTranslations('ns')` — also getTranslations, awaited, object arg, or namespace-less. */
const DECLARATION_RE =
  /(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\s*\(\s*(?:'([\w.-]+)'|"([\w.-]+)"|\{[^{}]*?namespace\s*:\s*(?:'([\w.-]+)'|"([\w.-]+)")[^{}]*?\})?\s*\)/g;

/** A key must look like a dotted path segment list. */
const KEY_SHAPE_RE = /^[\w-]+(?:\.[\w-]+)*$/;

export interface UsageIssue {
  file: string;
  line: number;
  key: string;
  candidates: string[];
}

export interface FileScan {
  /** namespace bindings found: variable name -> namespaces ('' = root). */
  bindings: Map<string, Set<string>>;
  /** statically resolved references: { key, line, candidates }. */
  refs: Array<{ key: string; line: number; candidates: string[] }>;
  /** translator calls whose argument was not a static literal. */
  dynamicCalls: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Remove block comments (incl. JSDoc usage examples) and whole-line `//`
 * comments so commented-out code never counts as a key reference. Newlines
 * inside block comments are preserved to keep reported line numbers correct.
 * Trailing `//` comments are left alone on purpose — stripping them naively
 * would eat string contents like 'https://…'.
 */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/[^\n]*/gm, '');
}

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === '\n') line += 1;
  }
  return line;
}

/** Extract namespace bindings + literal key references from one source file. */
export function scanSource(rawSource: string): FileScan {
  const source = stripComments(rawSource);
  const bindings = new Map<string, Set<string>>();
  for (const m of source.matchAll(DECLARATION_RE)) {
    const name = m[1]!;
    const ns = m[2] ?? m[3] ?? m[4] ?? m[5] ?? '';
    if (!bindings.has(name)) bindings.set(name, new Set());
    bindings.get(name)!.add(ns);
  }

  const refs: FileScan['refs'] = [];
  let dynamicCalls = 0;

  for (const [name, namespaces] of bindings) {
    const esc = escapeRegExp(name);
    // Any call through the translator (or its .rich/.raw/.markup/.has).
    const callRe = new RegExp(
      `(?<![\\w.$])${esc}(?:\\.(?:rich|raw|markup|has))?\\(\\s*(?:'([^'\\n]*)'|"([^"\\n]*)"|\`([^\`]*)\`)?`,
      'g',
    );
    for (const m of source.matchAll(callRe)) {
      const literal = m[1] ?? m[2] ?? m[3];
      if (literal === undefined || (m[3] !== undefined && literal.includes('${'))) {
        dynamicCalls += 1; // variable / template-literal argument — skip
        continue;
      }
      if (!KEY_SHAPE_RE.test(literal)) {
        dynamicCalls += 1; // not key-shaped (e.g. free text) — skip
        continue;
      }
      const candidates = [...namespaces].map((ns) => (ns ? `${ns}.${literal}` : literal));
      refs.push({ key: literal, line: lineOf(source, m.index!), candidates });
    }
  }

  return { bindings, refs, dynamicCalls };
}

function isAllowlisted(candidates: string[]): boolean {
  for (const entry of USAGE_ALLOWLIST) {
    if (entry.endsWith('.*')) {
      const prefix = entry.slice(0, -1); // keep the trailing dot
      if (candidates.some((c) => c.startsWith(prefix))) return true;
    } else if (candidates.includes(entry)) {
      return true;
    }
  }
  return false;
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(join(dir, entry.name));
    } else if (SOURCE_FILE_RE.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      yield join(dir, entry.name);
    }
  }
}

function checkUsage(en: ReadonlySet<string>, ar: ReadonlySet<string>): boolean {
  const root = process.cwd();
  const issues: UsageIssue[] = [];
  let files = 0;
  let refs = 0;
  let dynamicCalls = 0;
  let allowlisted = 0;

  for (const dir of SCAN_DIRS) {
    for (const file of walk(resolve(root, dir))) {
      const scan = scanSource(readFileSync(file, 'utf8'));
      if (scan.bindings.size === 0) continue;
      files += 1;
      dynamicCalls += scan.dynamicCalls;
      // Fallback resolution pool: every namespace bound anywhere in the file.
      // Covers helpers that receive a differently-named translator as a
      // parameter (the local param is typically `t` while the call site
      // passes e.g. `tConflicts`).
      const fileNamespaces = [...new Set([...scan.bindings.values()].flatMap((s) => [...s]))];
      for (const ref of scan.refs) {
        refs += 1;
        const fallback = fileNamespaces.map((ns) => (ns ? `${ns}.${ref.key}` : ref.key));
        if (ref.candidates.some((c) => en.has(c) && ar.has(c))) continue;
        if (fallback.some((c) => en.has(c) && ar.has(c))) continue;
        if (isAllowlisted([...ref.candidates, ...fallback])) {
          allowlisted += 1;
          continue;
        }
        issues.push({
          file: relative(root, file),
          line: ref.line,
          key: ref.key,
          candidates: [...new Set([...ref.candidates, ...fallback])],
        });
      }
    }
  }

  if (issues.length === 0) {
    console.log(
      `[i18n] usage: ${refs} static key reference(s) across ${files} file(s) all resolve ` +
        `in both catalogs (${dynamicCalls} dynamic call(s) skipped, ${allowlisted} allowlisted).`,
    );
    return true;
  }

  console.error(`[i18n] ${issues.length} translation key reference(s) missing from the catalogs:`);
  for (const i of issues.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
    console.error(`    - ${i.file}:${i.line} t('${i.key}') — tried: ${i.candidates.join(', ')}`);
  }
  console.error(
    '\nAdd the missing keys to BOTH messages/en.json and messages/ar.json (or, for a\n' +
      'false positive of the static extractor, add the key to USAGE_ALLOWLIST in\n' +
      'scripts/check-i18n-sync.ts with a comment) and re-run pnpm i18n:check.',
  );
  return false;
}

// ---------------------------------------------------------------------------
// Self-test (`--self-test`) — inline fixtures for the extractor.
// ---------------------------------------------------------------------------

function selfTest(): void {
  const fixture = `
    'use client';
    import { useTranslations } from 'next-intl';
    import { getTranslations } from 'next-intl/server';

    export function A() {
      const t = useTranslations('admin.rooms');
      const tCommon = useTranslations('common');
      const label = t('name');
      const other = tCommon('save');
      const rich = t.rich('withMarkup');
      const dynamic = t(\`cat\${label}\`);
      const viaVar = t(label);
      return [label, other, rich, dynamic, viaVar];
    }

    export async function B() {
      const t = await getTranslations({ locale: 'ar', namespace: 'navigation' });
      const tRoot = await getTranslations('patients.file');
      return [t('home'), tRoot('tabProfile')];
    }

    export function C() {
      const t = useTranslations();
      return t('common.cancel');
    }

    /**
     * JSDoc usage example — must NOT count:
     *   <ConfirmDialog title={t('commented.exampleKey')} />
     */
    // const removed = t('commented.lineKey');
    export function D() {
      const t = useTranslations('real.ns');
      return t('kept');
    }
  `;

  const scan = scanSource(fixture);
  const assert = (cond: boolean, label: string): void => {
    if (!cond) {
      console.error(`[i18n:self-test] FAIL — ${label}`);
      process.exit(1);
    }
    console.log(`[i18n:self-test] ok — ${label}`);
  };

  const resolved = scan.refs.map((r) => r.candidates.join('|')).sort();
  assert(scan.bindings.get('t')?.has('admin.rooms') === true, "binds t → 'admin.rooms'");
  assert(scan.bindings.get('tCommon')?.has('common') === true, "binds tCommon → 'common'");
  assert(
    scan.bindings.get('t')?.has('navigation') === true,
    'object-arg getTranslations({ namespace }) binds',
  );
  assert(scan.bindings.get('t')?.has('') === true, 'namespace-less useTranslations() binds root');
  assert(
    resolved.some((r) => r.includes('admin.rooms.name')),
    "resolves t('name') → admin.rooms.name",
  );
  assert(
    resolved.some((r) => r.includes('common.save')),
    "resolves tCommon('save') → common.save",
  );
  assert(
    resolved.some((r) => r.includes('admin.rooms.withMarkup')),
    't.rich() keys are extracted',
  );
  assert(
    resolved.some((r) => r.includes('patients.file.tabProfile')),
    "getTranslations('ns') binding resolves",
  );
  assert(
    resolved.some((r) => r.split('|').includes('common.cancel')),
    'root-namespace keys pass through fully qualified',
  );
  assert(scan.dynamicCalls >= 2, 'template-literal and variable arguments are skipped as dynamic');
  assert(
    !resolved.some((r) => r.includes('cat${')),
    'no template fragments leak into resolved keys',
  );
  assert(
    !resolved.some((r) => r.includes('commented.exampleKey') || r.includes('commented.lineKey')),
    'keys inside block/line comments are stripped',
  );
  assert(
    resolved.some((r) => r.includes('real.ns.kept')),
    'code after stripped comments still scans (line numbers preserved)',
  );
  console.log('[i18n:self-test] all extractor fixtures passed.');
}

// ---------------------------------------------------------------------------

function main(): void {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }

  // Phase 1 — catalog parity.
  const en = new Set(collectKeys(loadCatalog('en')));
  const ar = new Set(collectKeys(loadCatalog('ar')));

  const missingInAr = diff(en, ar);
  const missingInEn = diff(ar, en);

  if (missingInAr.length > 0 || missingInEn.length > 0) {
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
  console.log(`[i18n] en + ar in sync — ${en.size} keys.`);

  // Phase 2 — code-usage check.
  if (!checkUsage(en, ar)) {
    process.exit(1);
  }
}

main();
