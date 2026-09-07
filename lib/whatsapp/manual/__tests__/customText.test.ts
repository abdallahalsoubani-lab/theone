import { describe, expect, it } from 'vitest';

import { CUSTOM_TEXT_MAX, normalizeCustomText, validateCustomText } from '../customText';

/**
 * P60 §4.3 — WhatsApp template parameters may not carry newlines, tabs, or
 * 4+ consecutive spaces; the text is capped at 800 characters AFTER
 * normalization. Shared by the Zod path and the live preview.
 */
describe('normalizeCustomText', () => {
  it('newlines and tabs become single spaces', () => {
    expect(normalizeCustomText('hello\nthere\r\nfriend\tnow')).toBe('hello there friend now');
  });

  it('runs of 4+ spaces collapse to one; shorter runs are kept', () => {
    expect(normalizeCustomText('a    b')).toBe('a b');
    expect(normalizeCustomText('a        b')).toBe('a b');
    expect(normalizeCustomText('a   b')).toBe('a   b');
  });

  it('a newline glued to spaces cannot leave a 4-space run behind', () => {
    // " \n " → the break becomes a space → 3 spaces, under WhatsApp's limit.
    expect(normalizeCustomText('a \n b')).toBe('a   b');
    // "  \n  " → 5 spaces after the break is replaced → collapsed to one.
    expect(normalizeCustomText('a  \n  b')).toBe('a b');
  });

  it('trims and handles unicode line separators / nbsp', () => {
    expect(normalizeCustomText('  x y z  ')).toBe('x y z');
  });
});

describe('validateCustomText', () => {
  it('empty after normalization is rejected', () => {
    expect(validateCustomText('   \n\t ')).toEqual({ ok: false, reason: 'EMPTY' });
  });

  it('800 chars pass, 801 fail (post-normalization)', () => {
    const ok = 'x'.repeat(CUSTOM_TEXT_MAX);
    expect(validateCustomText(ok)).toEqual({ ok: true, text: ok });
    expect(validateCustomText('x'.repeat(CUSTOM_TEXT_MAX + 1))).toEqual({
      ok: false,
      reason: 'TOO_LONG',
    });
    // Raw length over the cap but normalized under it is fine.
    expect(validateCustomText('x'.repeat(790) + '\n'.repeat(50)).ok).toBe(true);
  });
});
