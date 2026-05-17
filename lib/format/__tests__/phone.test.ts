import { describe, expect, it } from 'vitest';

import { formatPhone } from '../phone';

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
