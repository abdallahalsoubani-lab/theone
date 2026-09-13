import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P60 — the manual send end-to-end through the REAL senders (compose +
 * enqueue) on a db mock:
 *   - secretary sends a confirmation → outbound job with source=manual_panel
 *     + sentById, dispatch of the same type closed, MANUAL_MESSAGE_SENT audit;
 *   - silent mode is NEVER consulted; whatsappReachable=false still sends;
 *   - applicability enforced server-side (the three named rejections);
 *   - reminder goes through the shared builder; custom message is
 *     normalized, capped, hidden while pending, and previews exactly what
 *     is sent.
 */

const auditConfigs = vi.hoisted(
  () => [] as Array<{ extractAfter?: (r: never) => Record<string, unknown> }>,
);
vi.mock('@/lib/audit/withAudit', () => ({
  withAudit: (cfg: (typeof auditConfigs)[number], fn: unknown) => {
    auditConfigs.push(cfg);
    return fn;
  },
}));

const enqueued = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock('@/lib/queue/jobs/whatsappOutbound', () => ({
  enqueueWhatsappOutbound: vi.fn(async (job: Record<string, unknown>) => {
    enqueued.push(job);
    return `job-${enqueued.length}`;
  }),
}));

const closeMock = vi.hoisted(() => vi.fn(async () => ({ closed: 1 })));
vi.mock('@/lib/whatsapp/dispatch/service', () => ({
  closeOpenDispatchForManualSend: closeMock,
}));

const silentSpy = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@/lib/whatsapp/silent-mode', () => ({
  isSilentModeOn: silentSpy,
  holdForOutbox: vi.fn(),
  reparkScheduled: vi.fn(),
}));

vi.mock('@/lib/intake-links/queries', () => ({
  unusedLinkForAppointment: vi.fn(async () => null),
}));
vi.mock('@/lib/time/clinic-server', () => ({ getClinicTimeZone: vi.fn(async () => 'Asia/Amman') }));
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://x.test' } }));

const FRAMES: Record<string, string> = {
  appointment_confirmation_v2: 'مرحباً {{1}}، تم تأكيد موعدك مع {{2}} بتاريخ {{3}} الساعة {{4}}.',
  appointment_reminder_single_v3: 'نذكّركم بموعدكم غداً الساعة {{1}}.',
  appointment_rescheduled: 'تم تغيير موعدكم {{1}} {{2}} {{3}} {{4}}',
  appointment_cancelled_v2: 'أُلغي موعدك بتاريخ {{1}} الساعة {{2}}. السبب: {{3}}.',
  arrival_confirmation: 'أهلاً {{1}}، تم تسجيل وصولك.',
  clinic_custom_message: 'مرحباً {{1}}،\nرسالة من المركز:\n\n{{2}}\n\nللاستفسار اتصل بنا.',
};

const state = vi.hoisted(() => ({
  appt: null as Record<string, unknown> | null,
  customApproved: true,
  lastSent: null as Date | null,
}));

vi.mock('@/lib/db', () => ({
  db: {
    appointment: {
      findUnique: vi.fn(async () => state.appt),
      findMany: vi.fn(async () =>
        state.appt
          ? [
              {
                id: state.appt.id,
                startsAt: state.appt.startsAt,
                durationMinutes: 60,
                therapists: [],
              },
            ]
          : [],
      ),
    },
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const a = state.appt as Record<string, unknown> | null;
        if (!a) return null;
        const scalar = a.patient as Record<string, unknown> | null;
        if (scalar && scalar.id === where.id) return scalar;
        const members = (a.groupPatients ?? []) as Array<{ patient: Record<string, unknown> }>;
        return members.find((g) => g.patient.id === where.id)?.patient ?? null;
      }),
    },
    whatsAppTemplate: {
      findUnique: vi.fn(async ({ where }: { where: { name_language: { name: string } } }) => ({
        variablesShape: null,
        twilioApproved:
          where.name_language.name === 'clinic_custom_message' ? state.customApproved : true,
        contentPreview: FRAMES[where.name_language.name] ?? 'T:{{1}}|{{2}}|{{3}}|{{4}}',
      })),
      findMany: vi.fn(async () => [
        { name: 'appointment_reminder_single_v3', twilioApproved: true },
        { name: 'appointment_reminder_multi', twilioApproved: true },
      ]),
    },
    whatsAppMessage: {
      findMany: vi.fn(async ({ where }: { where: { recipientId?: { in: string[] } } }) =>
        state.lastSent
          ? (where.recipientId?.in ?? []).map((recipientId) => ({
              recipientId,
              sentAt: state.lastSent,
            }))
          : [],
      ),
    },
  },
}));

import { substituteTemplateBody } from '@/lib/whatsapp/templates/render';

import {
  ManualSendError,
  getManualMessageOptions,
  lastSentByRecipient,
  sendManualAppointmentMessage,
  type ManualSendResult,
} from '../service';

const FUTURE = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
function appt(over: Record<string, unknown> = {}, patientOver: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    status: 'SCHEDULED',
    startsAt: FUTURE,
    durationMinutes: 60,
    checkedInAt: null,
    cancellationCategory: null,
    appointmentType: 'SESSION',
    patientId: 'p1',
    patient: {
      id: 'p1',
      phone: '+962790000001',
      languagePref: 'AR',
      whatsappReachable: true,
      fullNameEn: 'Sara Khalil',
      fullNameAr: 'سارة خليل',
      ...patientOver,
    },
    groupPatients: [],
    therapists: [{ therapist: { fullNameEn: 'Dr. Lina', fullNameAr: 'د. لينا' } }],
    ...over,
  };
}

const ACTOR = 'sec-1';
const send = (type: string, extra: Record<string, unknown> = {}) =>
  sendManualAppointmentMessage({
    appointmentId: 'a1',
    type: type as never,
    resend: false,
    actorId: ACTOR,
    ...extra,
  });

/** P61 — the send is a batch now; the single-recipient assertions read the
 *  one and only result. */
const sendOne = async (
  type: string,
  extra: Record<string, unknown> = {},
): Promise<ManualSendResult> => {
  const batch = await send(type, extra);
  const first = batch.results[0]!;
  if (!first.ok) throw new ManualSendError(first.code);
  return first.result;
};

/**
 * A GROUP appointment: no scalar patient, N members in the M2M.
 *
 * P61 follow-up — `patient: null` and `patientId: null` are the POINT of this
 * fixture. Production groups have no scalar relation at all, so any code that
 * silently falls back to it (as the panel's `hasPhone` did) must fail here
 * rather than quietly read a populated scalar patient.
 */
function groupAppt(members: Array<Record<string, unknown>>, over: Record<string, unknown> = {}) {
  return appt({
    appointmentType: 'GROUP',
    patientId: null,
    patient: null,
    groupPatients: members.map((m) => ({
      checkedInAt: (m.checkedInAt as Date | null) ?? null,
      patient: {
        id: m.id,
        phone: m.phone === undefined ? `+96279000000${m.id}` : m.phone,
        languagePref: m.languagePref ?? 'AR',
        whatsappReachable: true,
        fullNameEn: m.fullNameEn ?? `Patient ${m.id}`,
        fullNameAr: m.fullNameAr ?? `مريض ${m.id}`,
      },
    })),
    ...over,
  });
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  enqueued.length = 0;
  closeMock.mockClear();
  silentSpy.mockClear();
  state.appt = null;
  state.customApproved = true;
  state.lastSent = null;
});

describe('sendManualAppointmentMessage — confirmation from the panel', () => {
  it('enqueues through the shared sender with manual_panel + sentById, closes the auto dispatch, audits', async () => {
    state.appt = appt();
    const r = await sendOne('CONFIRMATION');
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({
      kind: 'template',
      templateName: 'appointment_confirmation_v2',
      language: 'AR',
      recipientPhone: '+962790000001',
      recipientUserId: 'p1',
      appointmentId: 'a1',
      source: 'manual_panel',
      sentById: ACTOR,
    });
    expect(closeMock).toHaveBeenCalledWith({
      appointmentId: 'a1',
      type: 'BOOKING_CONFIRMATION',
      patientId: 'p1',
    });
    expect(r).toMatchObject({
      type: 'CONFIRMATION',
      templateName: 'appointment_confirmation_v2',
      language: 'AR',
      jobId: 'job-1',
      resend: false,
      closedDispatch: 1,
    });
    // Audit event shape (decorator config captured at import).
    const cfg = auditConfigs.find((c) => {
      const after = c.extractAfter?.(r as never);
      return after?.event === 'MANUAL_MESSAGE_SENT';
    });
    expect(cfg).toBeDefined();
    expect(cfg!.extractAfter!(r as never)).toMatchObject({
      event: 'MANUAL_MESSAGE_SENT',
      appointmentId: 'a1',
      type: 'CONFIRMATION',
      templateName: 'appointment_confirmation_v2',
      lang: 'AR',
      resend: false,
    });
  });

  it('never consults the silent mode (human-initiated)', async () => {
    state.appt = appt();
    await send('CONFIRMATION');
    expect(silentSpy).not.toHaveBeenCalled();
    expect(enqueued).toHaveLength(1);
  });

  it('whatsappReachable=false still sends (force)', async () => {
    state.appt = appt({}, { whatsappReachable: false });
    await send('CONFIRMATION');
    expect(enqueued).toHaveLength(1);
  });

  it('records resend=true when the action layer confirmed a second send', async () => {
    state.appt = appt();
    const r = await sendOne('CONFIRMATION', { resend: true });
    expect(r.resend).toBe(true);
  });
});

describe('server-side applicability (never trusts the UI)', () => {
  it('cancellation on a SCHEDULED appointment → TYPE_NOT_APPLICABLE', async () => {
    state.appt = appt();
    await expect(send('CANCELLATION')).rejects.toMatchObject({ code: 'TYPE_NOT_APPLICABLE' });
    expect(enqueued).toHaveLength(0);
  });

  it('confirmation on a CANCELLED appointment → TYPE_NOT_APPLICABLE', async () => {
    state.appt = appt({ status: 'CANCELLED' });
    await expect(send('CONFIRMATION')).rejects.toMatchObject({ code: 'TYPE_NOT_APPLICABLE' });
  });

  it('arrival on a not-checked-in appointment → TYPE_NOT_APPLICABLE', async () => {
    state.appt = appt();
    await expect(send('ARRIVAL')).rejects.toMatchObject({ code: 'TYPE_NOT_APPLICABLE' });
  });

  it('cancellation on a CANCELLED appointment sends the cancelled template', async () => {
    state.appt = appt({ status: 'CANCELLED', cancellationCategory: 'PATIENT_REQUEST' });
    await send('CANCELLATION');
    expect(enqueued[0]).toMatchObject({
      templateName: 'appointment_cancelled_v2',
      source: 'manual_panel',
    });
    expect(closeMock).toHaveBeenCalledWith({
      appointmentId: 'a1',
      type: 'CANCELLATION',
      patientId: 'p1',
    });
  });

  it('arrival on a checked-in appointment sends the arrival template', async () => {
    state.appt = appt({
      status: 'IN_PROGRESS',
      startsAt: new Date(Date.now() - 10 * 60 * 1000),
      checkedInAt: new Date(),
    });
    await send('ARRIVAL');
    expect(enqueued[0]).toMatchObject({
      templateName: 'arrival_confirmation',
      parameters: ['سارة'],
      source: 'manual_panel',
    });
    expect(closeMock).toHaveBeenCalledWith({
      appointmentId: 'a1',
      type: 'ARRIVAL',
      patientId: 'p1',
    });
  });

  it('missing patient / phone are refused with their own codes', async () => {
    state.appt = appt({ patient: null });
    await expect(send('CONFIRMATION')).rejects.toMatchObject({ code: 'NO_PATIENT' });
    state.appt = appt({}, { phone: null });
    await expect(send('CONFIRMATION')).rejects.toMatchObject({ code: 'NO_PHONE' });
    state.appt = null;
    await expect(send('CONFIRMATION')).rejects.toMatchObject({ code: 'APPOINTMENT_NOT_FOUND' });
  });
});

describe('reminder from the panel — the shared builder', () => {
  it('uses the v3 single template the worker would use; closes REMINDER holds only', async () => {
    state.appt = appt();
    const r = await sendOne('REMINDER');
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({
      templateName: 'appointment_reminder_single_v3',
      source: 'manual_panel',
      sentById: ACTOR,
      appointmentId: 'a1',
    });
    expect(r.templateName).toBe('appointment_reminder_single_v3');
    // Decision 6: the dispatch close is typed REMINDER (the P17 job itself is
    // never touched — pinned in the dispatch close test).
    expect(closeMock).toHaveBeenCalledWith({
      appointmentId: 'a1',
      type: 'REMINDER',
      patientId: 'p1',
    });
  });
});

describe('custom message', () => {
  it('hidden/refused while the frame is pending approval for the patient language', async () => {
    state.customApproved = false;
    state.appt = appt();
    await expect(send('CUSTOM', { customText: 'hello' })).rejects.toMatchObject({
      code: 'CUSTOM_TEMPLATE_PENDING',
    });
    const o = await getManualMessageOptions('a1');
    expect(o.customApprovedByLanguage.AR).toBe(false);
    expect(o.customFrameByLanguage.AR).toBeNull();
    expect(o.options.map((x) => x.type)).not.toContain('CUSTOM');
  });

  it('normalizes the text (newlines → spaces, 4+ spaces collapsed) and sends inside the frame', async () => {
    state.appt = appt();
    await send('CUSTOM', { customText: '  hi\n\nthere     friend\t!  ' });
    expect(enqueued[0]).toMatchObject({
      templateName: 'clinic_custom_message',
      language: 'AR',
      parameters: ['سارة', 'hi there friend !'],
      source: 'manual_panel',
      sentById: ACTOR,
      appointmentId: 'a1',
    });
    // No automatic counterpart → nothing to close.
    expect(closeMock).not.toHaveBeenCalled();
  });

  it('empty and over-cap texts are refused', async () => {
    state.appt = appt();
    await expect(send('CUSTOM', { customText: ' \n ' })).rejects.toMatchObject({
      code: 'CUSTOM_TEXT_EMPTY',
    });
    await expect(send('CUSTOM', { customText: 'x'.repeat(801) })).rejects.toMatchObject({
      code: 'CUSTOM_TEXT_TOO_LONG',
    });
    expect(enqueued).toHaveLength(0);
  });

  it('the live preview (frame + normalized text) equals the sent body', async () => {
    state.appt = appt();
    const o = await getManualMessageOptions('a1');
    const raw = 'first line\nsecond    line';
    await send('CUSTOM', { customText: raw });
    const sentBody = substituteTemplateBody(
      FRAMES.clinic_custom_message!,
      enqueued[0]!.parameters as string[],
    );
    const { normalizeCustomText } = await import('../customText');
    const previewBody = substituteTemplateBody(o.customFrameByLanguage.AR!, [
      o.recipients[0]!.firstName,
      normalizeCustomText(raw),
    ]);
    expect(previewBody).toBe(sentBody);
    expect(previewBody).toContain('first line second line');
  });
});

describe('getManualMessageOptions + lastSentByRecipient', () => {
  it('lists applicable types with previews equal to the composed body, and last-sent times', async () => {
    state.appt = appt();
    state.lastSent = new Date('2030-05-01T10:00:00Z');
    const o = await getManualMessageOptions('a1');
    expect(o.recipients).toHaveLength(1);
    expect(o.recipients[0]).toMatchObject({ patientId: 'p1', language: 'AR', hasPhone: true });
    expect(o.recipients[0]!.firstName).toBe('سارة');
    expect(o.options.map((x) => x.type)).toEqual([
      'CONFIRMATION',
      'REMINDER',
      'RESCHEDULE',
      'CUSTOM',
    ]);
    const conf = o.options.find((x) => x.type === 'CONFIRMATION')!;
    expect(conf.previewByLanguage.AR).toContain('مرحباً Sara Khalil، تم تأكيد موعدك مع د. لينا');
    expect(conf.lastSentByRecipient.p1!.toISOString()).toBe('2030-05-01T10:00:00.000Z');
    const rem = o.options.find((x) => x.type === 'REMINDER')!;
    expect(rem.previewByLanguage.AR).toMatch(/نذكّركم بموعدكم غداً الساعة/);
    // Sending the confirmation produces exactly the previewed text.
    await send('CONFIRMATION');
    expect(
      substituteTemplateBody(
        FRAMES.appointment_confirmation_v2!,
        enqueued[0]!.parameters as string[],
      ),
    ).toBe(conf.previewByLanguage.AR);
  });

  it('EVENT / patient-less → no options, section hidden', async () => {
    state.appt = appt({ patient: null, patientId: null, appointmentType: 'EVENT' });
    const o = await getManualMessageOptions('a1');
    expect(o.recipients).toEqual([]);
    expect(o.options).toEqual([]);
  });

  it('lastSentByRecipient queries the template family of the type, per patient (non-failed outbound only)', async () => {
    const { db } = await import('@/lib/db');
    state.lastSent = new Date('2030-05-02T10:00:00Z');
    const map = await lastSentByRecipient('a1', 'REMINDER', ['p1', 'p2']);
    expect(map.get('p1')?.toISOString()).toBe('2030-05-02T10:00:00.000Z');
    expect(map.get('p2')?.toISOString()).toBe('2030-05-02T10:00:00.000Z');
    const call = (
      db.whatsAppMessage.findMany as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.at(-1)![0] as { where: Record<string, unknown> };
    expect(call.where).toMatchObject({
      appointmentId: 'a1',
      direction: 'OUTBOUND',
      status: { not: 'FAILED' },
      recipientId: { in: ['p1', 'p2'] },
      template: {
        name: {
          in: [
            'appointment_reminder_v2',
            'appointment_reminder_single_v3',
            'appointment_reminder_multi',
          ],
        },
      },
    });
  });

  it('ManualSendError carries the code', () => {
    expect(new ManualSendError('NO_PHONE').code).toBe('NO_PHONE');
  });
});

/**
 * P61 item 1 — the section must work on EVERY appointment that has a patient.
 * The production bug: a two-therapist booking (made as a GROUP, so the scalar
 * patientId is null) rendered no "Send a message" section at all.
 */
describe('P61 — every appointment with a patient can be messaged', () => {
  it('regression: 2 therapists + 1 patient → options, preview and send all work', async () => {
    state.appt = appt({
      therapists: [
        { therapist: { fullNameEn: 'Ola Osama', fullNameAr: 'علا أسامة' } },
        { therapist: { fullNameEn: 'Rana Adeeb', fullNameAr: 'رنا أديب' } },
      ],
    });
    const o = await getManualMessageOptions('a1');
    expect(o.recipients).toHaveLength(1);
    expect(o.options.map((x) => x.type)).toContain('CONFIRMATION');
    const conf = o.options.find((x) => x.type === 'CONFIRMATION')!;
    expect(conf.previewByLanguage.AR).toBeTruthy();
    const r = await sendOne('CONFIRMATION');
    expect(r.templateName).toBe('appointment_confirmation_v2');
    expect(enqueued).toHaveLength(1);
  });

  it('the therapist variable names the FIRST clinician — identical for 1 and 2 therapists', async () => {
    state.appt = appt();
    await sendOne('CONFIRMATION');
    const single = enqueued[0]!.parameters as string[];
    enqueued.length = 0;
    state.appt = appt({
      therapists: [
        { therapist: { fullNameEn: 'Dr. Lina', fullNameAr: 'د. لينا' } },
        { therapist: { fullNameEn: 'Rana Adeeb', fullNameAr: 'رنا أديب' } },
      ],
    });
    await sendOne('CONFIRMATION');
    // Byte-identical: adding a second therapist changes nothing that goes out.
    expect(enqueued[0]!.parameters).toEqual(single);
    expect(single[1]).toBe('د. لينا');
  });

  it('STRETCHING with zero therapists → section works, variable is the clinic fallback (never empty)', async () => {
    state.appt = appt({ appointmentType: 'STRETCHING', therapists: [] });
    const o = await getManualMessageOptions('a1');
    expect(o.recipients).toHaveLength(1);
    await sendOne('CONFIRMATION');
    const params = enqueued[0]!.parameters as string[];
    expect(params[1]).toBe('فريق العيادة');
    expect(params.every((p) => p.length > 0)).toBe(true);
  });

  it('GROUP with 3 patients → 3 messages, 3 audit events, ONE batchId, each in their own language', async () => {
    state.appt = groupAppt([
      { id: 'g1', languagePref: 'AR', fullNameEn: 'Sara Khalil', fullNameAr: 'سارة خليل' },
      { id: 'g2', languagePref: 'EN', fullNameEn: 'John Smith', fullNameAr: 'جون سميث' },
      { id: 'g3', languagePref: 'AR', fullNameEn: 'Lina Odeh', fullNameAr: 'لينا عودة' },
    ]);
    const batch = await send('CONFIRMATION');
    expect(batch.results).toHaveLength(3);
    expect(batch.results.every((r) => r.ok)).toBe(true);
    expect(enqueued).toHaveLength(3);
    expect(enqueued.map((e) => e.recipientUserId)).toEqual(['g1', 'g2', 'g3']);
    expect(enqueued.map((e) => e.language)).toEqual(['AR', 'EN', 'AR']);
    // Every row anchors to the same appointment and one traceable action.
    expect(enqueued.every((e) => e.appointmentId === 'a1')).toBe(true);
    const ids = new Set(batch.results.map((r) => (r.ok ? r.result.batchId : null)));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toBe(batch.batchId);
    // Each patient's OWN name (the display name is the English field since
    // P47, in both catalogs) — never the group's first member for everyone.
    expect((enqueued[0]!.parameters as string[])[0]).toBe('Sara Khalil');
    expect((enqueued[1]!.parameters as string[])[0]).toBe('John Smith');
    expect((enqueued[2]!.parameters as string[])[0]).toBe('Lina Odeh');
  });

  it('one recipient failing (no phone) never aborts the batch', async () => {
    state.appt = groupAppt([{ id: 'g1' }, { id: 'g2', phone: null }, { id: 'g3' }]);
    const batch = await send('CONFIRMATION');
    expect(batch.results.map((r) => r.ok)).toEqual([true, false, true]);
    expect(batch.results.find((r) => !r.ok)).toMatchObject({
      patientId: 'g2',
      code: 'NO_PHONE',
    });
    expect(enqueued).toHaveLength(2);
  });

  it('only the selected recipients are messaged; an id not on the appointment is rejected', async () => {
    state.appt = groupAppt([{ id: 'g1' }, { id: 'g2' }, { id: 'g3' }]);
    await send('CONFIRMATION', { recipientIds: ['g1', 'g3'] });
    expect(enqueued.map((e) => e.recipientUserId)).toEqual(['g1', 'g3']);
    enqueued.length = 0;
    await expect(
      send('CONFIRMATION', { recipientIds: ['g1', 'not-on-this-appointment'] }),
    ).rejects.toMatchObject({ code: 'RECIPIENT_NOT_ON_APPOINTMENT' });
    expect(enqueued).toHaveLength(0);
  });

  it('group previews are one per distinct language among the recipients', async () => {
    state.appt = groupAppt([
      { id: 'g1', languagePref: 'AR' },
      { id: 'g2', languagePref: 'AR' },
    ]);
    const arOnly = await getManualMessageOptions('a1');
    const conf = arOnly.options.find((x) => x.type === 'CONFIRMATION')!;
    expect(Object.keys(conf.previewByLanguage)).toEqual(['AR']);
    expect(conf.applicableRecipientIds).toEqual(['g1', 'g2']);
  });

  it('arrival is offered per membership — only the group members who arrived', async () => {
    state.appt = groupAppt([{ id: 'g1', checkedInAt: new Date() }, { id: 'g2' }], {
      status: 'IN_PROGRESS',
      startsAt: new Date(Date.now() - 10 * 60 * 1000),
    });
    const o = await getManualMessageOptions('a1');
    const arrival = o.options.find((x) => x.type === 'ARRIVAL')!;
    expect(arrival.applicableRecipientIds).toEqual(['g1']);
    await send('ARRIVAL', { recipientIds: ['g1'] });
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({ templateName: 'arrival_confirmation' });
  });

  it('REGRESSION: a ONE-member group is fully sendable (the live "no phone on file" bug)', async () => {
    // Every group on the clinic's calendar has exactly one member. The panel
    // used to read the phone off the null scalar relation for these and
    // refused to send; the service always had it right, which is why only a
    // panel-level test catches it (see __tests__/panelRecipients.test.ts).
    state.appt = groupAppt([{ id: 'alaa', phone: '+962788453529', fullNameEn: 'Alaa Alshmilan' }]);
    const o = await getManualMessageOptions('a1');
    expect(o.recipients).toEqual([expect.objectContaining({ patientId: 'alaa', hasPhone: true })]);
    expect(o.options.map((x) => x.type)).toContain('CONFIRMATION');
    const batch = await send('CONFIRMATION');
    expect(batch.results).toEqual([expect.objectContaining({ patientId: 'alaa', ok: true })]);
    expect(enqueued[0]).toMatchObject({
      recipientUserId: 'alaa',
      recipientPhone: '+962788453529',
      source: 'manual_panel',
    });
  });

  it('a group member with NO phone is the only case that reports no phone', async () => {
    state.appt = groupAppt([{ id: 'g1', phone: null }]);
    const o = await getManualMessageOptions('a1');
    expect(o.recipients).toEqual([expect.objectContaining({ patientId: 'g1', hasPhone: false })]);
    await expect(send('CONFIRMATION')).rejects.toMatchObject({ code: 'NO_PHONE' });
  });

  it('a group member never receives another patient’s intake link', async () => {
    const links = await import('@/lib/intake-links/queries');
    vi.mocked(links.unusedLinkForAppointment).mockResolvedValueOnce({ token: 'tok' });
    state.appt = groupAppt([{ id: 'g1' }]);
    await send('CONFIRMATION');
    expect(enqueued[0]!.templateName).toBe('appointment_confirmation_v2');
  });
});
