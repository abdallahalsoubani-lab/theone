import { describe, expect, it } from 'vitest';

import { normalizeInbound, parseIntent } from '../inbound/parser';

describe('normalizeInbound', () => {
  it('returns empty for whitespace-only input', () => {
    expect(normalizeInbound('   ')).toBe('');
    expect(normalizeInbound('')).toBe('');
  });

  it('strips Arabic diacritics', () => {
    expect(normalizeInbound('نَعَمْ')).toBe('نعم');
  });

  it('normalizes alif variants to bare ا', () => {
    expect(normalizeInbound('إلغاء')).toBe('الغاء');
    expect(normalizeInbound('أوكي')).toBe('اوكي');
    expect(normalizeInbound('آسف')).toBe('اسف');
  });

  it('lowercases Latin characters', () => {
    expect(normalizeInbound('Yes')).toBe('yes');
    expect(normalizeInbound('CONFIRM')).toBe('confirm');
  });

  it('strips tatweel', () => {
    expect(normalizeInbound('نــــعم')).toBe('نعم');
  });
});

describe('parseIntent — CONFIRM', () => {
  it.each([
    ['1'],
    ['yes'],
    ['Yes'],
    ['YES'],
    ['y'],
    ['confirm'],
    ['Confirm.'],
    ['ok'],
    ['Okay!'],
    ['sure'],
    ['نعم'],
    ['نَعَمْ'],
    ['نعمم'], // common typo
    ['موافق'],
    ['تأكيد'],
    ['تاكيد'], // hamza dropped
    ['اوكي'],
    ['أوكي'],
    ['اوك'],
    ['تمام'],
    ['اي'],
  ])('parses %s as CONFIRM', (body) => {
    expect(parseIntent(body)).toBe('CONFIRM');
  });
});

describe('parseIntent — RESCHEDULE_REQUEST', () => {
  it.each([
    ['2'],
    ['change'],
    ['reschedule'],
    ['Reschedule please'],
    ['غير'],
    ['تغيير'],
    ['تأجيل'],
    ['تاجيل'],
    ['موعد ثاني'],
    ['موعد جديد'],
    ['بدي تغيير'],
  ])('parses %s as RESCHEDULE_REQUEST', (body) => {
    expect(parseIntent(body)).toBe('RESCHEDULE_REQUEST');
  });
});

describe('parseIntent — CANCEL_REQUEST', () => {
  it.each([
    ['3'],
    ['cancel'],
    ['Cancel'],
    ['cancelled'],
    ['stop'],
    ['no'],
    ['إلغاء'],
    ['الغاء'],
    ['وقف'],
    ['لا'],
  ])('parses %s as CANCEL_REQUEST', (body) => {
    expect(parseIntent(body)).toBe('CANCEL_REQUEST');
  });
});

describe('parseIntent — UNKNOWN', () => {
  it.each([
    [''],
    ['   '],
    ['hello'],
    ['كيفك'], // "how are you" — not a structured response
    ['Thanks!'],
    ['شكرا'],
    ['I have a question about my appointment'],
    ['😀'],
    ['?'],
    ['can we make it 11am instead'], // free-form reschedule intent not in dictionary
  ])('parses %s as UNKNOWN', (body) => {
    expect(parseIntent(body)).toBe('UNKNOWN');
  });
});

describe('parseIntent — first-token matching', () => {
  it('only matches the first token; subsequent words do not override', () => {
    expect(parseIntent('yes please')).toBe('CONFIRM');
    expect(parseIntent('ok thanks')).toBe('CONFIRM');
    expect(parseIntent('please cancel')).toBe('UNKNOWN'); // first token is "please"
  });

  it('handles punctuation after the token', () => {
    expect(parseIntent('yes.')).toBe('CONFIRM');
    expect(parseIntent('cancel!')).toBe('CANCEL_REQUEST');
    expect(parseIntent('نعم،')).toBe('CONFIRM');
  });
});
