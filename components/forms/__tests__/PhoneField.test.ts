import { describe, expect, it } from 'vitest';

import { composePhone, splitStoredPhone } from '../PhoneField';

/**
 * P61 item 2 §2.3.2 — the country selector's pure parts. The secretary's
 * Jordanian flow must be byte-identical to before; a foreign number is a
 * country pick away.
 */
describe('composePhone', () => {
  it('Jordan + a local number → the canonical Jordanian value', () => {
    expect(composePhone('962', '0790123456')).toBe('+962790123456');
    expect(composePhone('962', '790123456')).toBe('+962790123456');
  });

  it('another country + its national number', () => {
    expect(composePhone('1', '4155552671')).toBe('+14155552671');
    expect(composePhone('971', '0501234567')).toBe('+971501234567');
  });

  it('a pasted full international number wins over the selector', () => {
    expect(composePhone('962', '+14155552671')).toBe('+14155552671');
    expect(composePhone('962', '0014155552671')).toBe('0014155552671');
  });

  it('empty stays empty (phone is optional since P50)', () => {
    expect(composePhone('962', '')).toBe('');
    expect(composePhone('962', '   ')).toBe('');
  });
});

describe('splitStoredPhone', () => {
  it('splits a stored Jordanian number back for editing', () => {
    expect(splitStoredPhone('+962790123456')).toEqual({ dial: '962', national: '790123456' });
  });

  it('splits a stored foreign number on the longest matching dial code', () => {
    expect(splitStoredPhone('+14155552671')).toEqual({ dial: '1', national: '4155552671' });
    expect(splitStoredPhone('+971501234567')).toEqual({ dial: '971', national: '501234567' });
  });

  it('defaults to Jordan for an empty or non-E.164 value', () => {
    expect(splitStoredPhone(null)).toEqual({ dial: '962', national: '' });
    expect(splitStoredPhone('0790123456')).toEqual({ dial: '962', national: '0790123456' });
  });

  it('round-trips: split then compose returns the stored value', () => {
    for (const stored of ['+962790123456', '+14155552671', '+971501234567']) {
      const { dial, national } = splitStoredPhone(stored);
      expect(composePhone(dial, national)).toBe(stored);
    }
  });
});
