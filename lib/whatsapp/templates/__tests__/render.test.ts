import { describe, expect, it } from 'vitest';

import { orderedParams, renderWaBody, substituteTemplateBody } from '../render';

/**
 * P52 follow-up — template messages displayed as raw
 * `template:name(params)` code to the secretary. The renderer recomposes
 * the real text from the registry body + stored params.
 */

const AR_BODY = 'مرحباً {{1}}، تم تأكيد موعدك مع {{2}} بتاريخ {{3}} الساعة {{4}}. نراك قريباً.';
const EN_BODY =
  'Hi {{1}}, your appointment with {{2}} on {{3}} at {{4}} is confirmed. See you soon.';

describe('renderWaBody', () => {
  it('recomposes the ARABIC template text from the live raw form + row params', () => {
    const r = renderWaBody({
      body: 'template:appointment_reminder_v2(اسراء عبد الباري, 16:00, 27-07-2026)',
      parameters: { '1': 'اسراء عبد الباري', '2': 'د. سحر', '3': '27-07-2026', '4': '16:00' },
      templateContentPreview: AR_BODY,
    });
    expect(r).toEqual({
      kind: 'template',
      text: 'مرحباً اسراء عبد الباري، تم تأكيد موعدك مع د. سحر بتاريخ 27-07-2026 الساعة 16:00. نراك قريباً.',
    });
  });

  it('recomposes the ENGLISH template text', () => {
    const r = renderWaBody({
      body: 'template:appointment_confirmation_v2(Sara, Dr. X, 2026-07-27, 16:00)',
      parameters: { '1': 'Sara', '2': 'Dr. X', '3': '2026-07-27', '4': '16:00' },
      templateContentPreview: EN_BODY,
    });
    expect(r.kind).toBe('template');
    expect((r as { text: string }).text).toBe(
      'Hi Sara, your appointment with Dr. X on 2026-07-27 at 16:00 is confirmed. See you soon.',
    );
  });

  it('legacy row WITHOUT stored parameters falls back to parsing the parenthetical', () => {
    const r = renderWaBody({
      body: 'template:appointment_reminder_v2(سارة, 10:00, الاثنين)',
      parameters: {},
      templateContentPreview: 'تذكير: {{1}} الساعة {{2}} يوم {{3}}',
    });
    expect(r).toEqual({ kind: 'template', text: 'تذكير: سارة الساعة 10:00 يوم الاثنين' });
  });

  it('registry row gone → clean FRIENDLY fallback, never the raw form', () => {
    const r = renderWaBody({
      body: 'template:appointment_reminder_v2(سارة, 10:00)',
      parameters: { '1': 'سارة', '2': '10:00' },
      templateContentPreview: null,
    });
    expect(r).toEqual({
      kind: 'templateFallback',
      templateName: 'appointment_reminder_v2',
      params: ['سارة', '10:00'],
    });
  });

  it('free-form session text is untouched', () => {
    const r = renderWaBody({ body: 'أهلاً، كيف نساعدك؟', parameters: {} });
    expect(r).toEqual({ kind: 'text', text: 'أهلاً، كيف نساعدك؟' });
    // A composed post-fix row (already readable) also passes through.
    const composed = renderWaBody({
      body: 'مرحباً سارة، تم تأكيد موعدك.',
      parameters: { '1': 'سارة' },
    });
    expect(composed.kind).toBe('text');
  });

  it('missing params leave the placeholder visible rather than vanishing', () => {
    expect(substituteTemplateBody('مرحباً {{1}} — {{2}}', ['سارة'])).toBe('مرحباً سارة — {{2}}');
  });

  it('orderedParams sorts the JSON keys numerically (10 after 9)', () => {
    expect(orderedParams({ '2': 'b', '10': 'j', '1': 'a', '9': 'i' })).toEqual([
      'a',
      'b',
      'i',
      'j',
    ]);
  });
});
