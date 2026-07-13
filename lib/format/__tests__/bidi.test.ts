import { describe, expect, it } from 'vitest';

import { bidiIsolate } from '../bidi';

describe('bidiIsolate (QA 6.5)', () => {
  it('wraps a value in FSI … PDI isolates', () => {
    expect(bidiIsolate('Abdullah Soubani')).toBe('\u2068Abdullah Soubani\u2069');
  });

  it('isolates Arabic values the same way (direction comes from content)', () => {
    expect(bidiIsolate('د. سارة الخطيب')).toBe('\u2068د. سارة الخطيب\u2069');
  });

  it('passes empty strings through untouched', () => {
    expect(bidiIsolate('')).toBe('');
  });

  it('is idempotent-safe for display (nested isolates still render)', () => {
    const once = bidiIsolate('x');
    expect(bidiIsolate(once)).toBe(`\u2068${once}\u2069`);
  });
});
