import { describe, expect, it } from 'vitest';

import { exerciseDisplayName, hasVersionHistory } from '../display-name';
import { normalizeName, normalizeText } from '@/lib/text/normalize';

/**
 * PT-B5 item 2 — the doctor's two asks: tell the versions of an exercise
 * apart wherever it is listed, and stop a brand-new exercise from taking a
 * name that is already in use.
 */

const suffix = (version: number) => `(v${version})`;

describe('exerciseDisplayName', () => {
  it('leaves a never-edited exercise alone — no "v1" noise across the library', () => {
    expect(exerciseDisplayName('Wall pushup', { version: 1 }, suffix)).toBe('Wall pushup');
    expect(hasVersionHistory({ version: 1, superseded: false })).toBe(false);
  });

  it('marks the newer version', () => {
    expect(exerciseDisplayName('Wall pushup', { version: 2 }, suffix)).toBe('Wall pushup (v2)');
  });

  it('marks the REPLACED v1 too — otherwise "v2" sits next to a bare name', () => {
    expect(exerciseDisplayName('Wall pushup', { version: 1, superseded: true }, suffix)).toBe(
      'Wall pushup (v1)',
    );
  });

  it('keeps both ends of a chain distinguishable from each other', () => {
    const v1 = exerciseDisplayName('Wall pushup', { version: 1, superseded: true }, suffix);
    const v2 = exerciseDisplayName('Wall pushup', { version: 2 }, suffix);
    expect(v1).not.toBe(v2);
  });

  it('takes the suffix from the caller, so the wording stays translatable', () => {
    expect(exerciseDisplayName('تمرين الإطالة', { version: 3 }, (v) => `(نسخة ${v})`)).toBe(
      'تمرين الإطالة (نسخة 3)',
    );
  });
});

describe('name normalization — what counts as the same name', () => {
  it('folds Arabic alif variants', () => {
    expect(normalizeName('تمرين الإطالة')).toBe(normalizeName('تمرين الاطالة'));
    expect(normalizeName('تمرين الأطالة')).toBe(normalizeName('تمرين الآطالة'));
  });

  it('folds yaa / alif-maqsura and taa-marbuta', () => {
    expect(normalizeName('مشى')).toBe(normalizeName('مشي'));
    expect(normalizeName('إطالة')).toBe(normalizeName('إطاله'));
  });

  it('strips diacritics and tatweel', () => {
    expect(normalizeName('نَعَم')).toBe(normalizeName('نعم'));
    expect(normalizeName('تمــرين')).toBe(normalizeName('تمرين'));
  });

  it('ignores case and surrounding whitespace', () => {
    expect(normalizeName('  Wall Pushup ')).toBe(normalizeName('wall pushup'));
  });

  it('collapses internal whitespace, which normalizeText deliberately does not', () => {
    expect(normalizeName('Wall   pushup')).toBe('wall pushup');
    // The WhatsApp parser splits the folded body on spaces to read the first
    // token, so its fold must NOT collapse them.
    expect(normalizeText('Wall   pushup')).toBe('wall   pushup');
  });

  it('still tells genuinely different names apart', () => {
    expect(normalizeName('Wall pushup')).not.toBe(normalizeName('Wall pushups'));
    expect(normalizeName('إطالة الكتف')).not.toBe(normalizeName('إطالة الرقبة'));
  });

  it('handles empty and whitespace-only input without throwing', () => {
    expect(normalizeName('')).toBe('');
    expect(normalizeName('   ')).toBe('');
  });
});
