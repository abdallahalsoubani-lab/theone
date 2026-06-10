import { describe, expect, it } from 'vitest';

import { formatPhone, normalizeJordanPhone } from '../phone';

const LRM = '‎';

describe('formatPhone', () => {
  it('formats a bare 12-digit Jordan number with country code', () => {
    expect(formatPhone('962790123456')).toBe(`${LRM}+962 79 012 3456${LRM}`);
  });

  it('formats an E.164 number with leading +', () => {
    expect(formatPhone('+962790123456')).toBe(`${LRM}+962 79 012 3456${LRM}`);
  });

  it('formats a local 0-prefixed number', () => {
    expect(formatPhone('0790123456')).toBe(`${LRM}+962 79 012 3456${LRM}`);
  });

  it('formats a 00-prefixed international number', () => {
    expect(formatPhone('00962790123456')).toBe(`${LRM}+962 79 012 3456${LRM}`);
  });

  it('strips non-digit punctuation from the input', () => {
    expect(formatPhone('+962-79-012-3456')).toBe(`${LRM}+962 79 012 3456${LRM}`);
    expect(formatPhone('+962 (79) 012-3456')).toBe(`${LRM}+962 79 012 3456${LRM}`);
  });

  it('LRM-wraps but does not reformat unrecognised input', () => {
    expect(formatPhone('not a phone')).toBe(`${LRM}not a phone${LRM}`);
    expect(formatPhone('+1 555 555 5555')).toBe(`${LRM}+1 555 555 5555${LRM}`);
  });

  it('wraps even an empty / whitespace-only string without crashing', () => {
    expect(formatPhone('')).toBe(`${LRM}${LRM}`);
    expect(formatPhone('   ')).toBe(`${LRM}${LRM}`);
  });
});

describe('normalizeJordanPhone', () => {
  it('normalises every accepted shape to canonical E.164', () => {
    for (const input of [
      '790123456',
      '0790123456',
      '962790123456',
      '+962790123456',
      '00962790123456',
      '+962 (79) 012-3456',
    ]) {
      expect(normalizeJordanPhone(input)).toBe('+962790123456');
    }
  });

  it('accepts 77/78/79 mobile prefixes', () => {
    expect(normalizeJordanPhone('0771234567')).toBe('+962771234567');
    expect(normalizeJordanPhone('0781234567')).toBe('+962781234567');
  });

  it('rejects non-Jordan-mobile input as null (no silent mismatch)', () => {
    expect(normalizeJordanPhone('not a phone')).toBeNull();
    expect(normalizeJordanPhone('+1 555 555 5555')).toBeNull();
    expect(normalizeJordanPhone('0612345678')).toBeNull(); // landline, not 7-led
    expect(normalizeJordanPhone('079012345')).toBeNull(); // too short
    expect(normalizeJordanPhone('07901234567')).toBeNull(); // too long
    expect(normalizeJordanPhone('')).toBeNull();
  });
});
