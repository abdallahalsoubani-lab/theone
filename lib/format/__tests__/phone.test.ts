import { describe, expect, it } from 'vitest';

import {
  formatPhone,
  normalizeInternationalPhone,
  normalizeJordanPhone,
  normalizePhoneForStorage,
} from '../phone';

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

  it('renders the em-dash placeholder for missing phones (P50 — phone is optional)', () => {
    expect(formatPhone('')).toBe('—');
    expect(formatPhone('   ')).toBe('—');
    expect(formatPhone(null)).toBe('—');
    expect(formatPhone(undefined)).toBe('—');
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

describe('normalizeInternationalPhone (P58 item 3)', () => {
  it('clean international E.164 survives intact', () => {
    expect(normalizeInternationalPhone('+97433991799')).toBe('+97433991799');
    expect(normalizeInternationalPhone('+966501234567')).toBe('+966501234567');
    expect(normalizeInternationalPhone('+15551234567')).toBe('+15551234567');
  });

  it('strips the separators people paste — the Saed case', () => {
    expect(normalizeInternationalPhone('+972 52-505-4631')).toBe('+972525054631');
    expect(normalizeInternationalPhone('+966 (50) 123.4567')).toBe('+966501234567');
  });

  it('converts the 00 international prefix', () => {
    expect(normalizeInternationalPhone('0097433991799')).toBe('+97433991799');
  });

  it('rejects garbage as null — never stored, never guessed', () => {
    expect(normalizeInternationalPhone('not a phone')).toBeNull();
    expect(normalizeInternationalPhone('052-505-4631')).toBeNull(); // national format, no country code
    expect(normalizeInternationalPhone('+972abc123')).toBeNull();
    expect(normalizeInternationalPhone('+12345')).toBeNull(); // too short
    expect(normalizeInternationalPhone('+1234567890123456')).toBeNull(); // too long
    expect(normalizeInternationalPhone('')).toBeNull();
  });
});

describe('normalizePhoneForStorage (P58 item 3 — THE storage chain)', () => {
  it('Jordanian convenience shapes still canonicalise first (UX unchanged)', () => {
    expect(normalizePhoneForStorage('0790123456')).toBe('+962790123456');
    expect(normalizePhoneForStorage('790123456')).toBe('+962790123456');
    expect(normalizePhoneForStorage('00962790123456')).toBe('+962790123456');
  });

  it('non-Jordanian numbers fall through to international normalisation', () => {
    expect(normalizePhoneForStorage('+97433991799')).toBe('+97433991799');
    expect(normalizePhoneForStorage('+972 52-505-4631')).toBe('+972525054631');
  });

  it('unresolvable input is null', () => {
    expect(normalizePhoneForStorage('052-505-4631')).toBeNull();
    expect(normalizePhoneForStorage('hello')).toBeNull();
  });
});
