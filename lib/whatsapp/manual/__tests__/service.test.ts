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
      findUnique: vi.fn(async () => (state.appt?.patient as Record<string, unknown>) ?? null),
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
      findFirst: vi.fn(async () => (state.lastSent ? { sentAt: state.lastSent } : null)),
    },
  },
}));

import { substituteTemplateBody } from '@/lib/whatsapp/templates/render';

import {
  ManualSendError,
  getManualMessageOptions,
  lastSentOfType,
  sendManualAppointmentMessage,
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
    const r = await send('CONFIRMATION');
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
    expect(closeMock).toHaveBeenCalledWith({ appointmentId: 'a1', type: 'BOOKING_CONFIRMATION' });
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
    const r = await send('CONFIRMATION', { resend: true });
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
    expect(closeMock).toHaveBeenCalledWith({ appointmentId: 'a1', type: 'CANCELLATION' });
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
    expect(closeMock).toHaveBeenCalledWith({ appointmentId: 'a1', type: 'ARRIVAL' });
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
    const r = await send('REMINDER');
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
    expect(closeMock).toHaveBeenCalledWith({ appointmentId: 'a1', type: 'REMINDER' });
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
    expect(o.customApproved).toBe(false);
    expect(o.customFrame).toBeNull();
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
    const previewBody = substituteTemplateBody(o.customFrame!, [
      o.patientFirstName,
      normalizeCustomText(raw),
    ]);
    expect(previewBody).toBe(sentBody);
    expect(previewBody).toContain('first line second line');
  });
});

describe('getManualMessageOptions + lastSentOfType', () => {
  it('lists applicable types with previews equal to the composed body, and last-sent times', async () => {
    state.appt = appt();
    state.lastSent = new Date('2030-05-01T10:00:00Z');
    const o = await getManualMessageOptions('a1');
    expect(o).toMatchObject({ hasPatient: true, hasPhone: true, language: 'AR' });
    expect(o.patientFirstName).toBe('سارة');
    expect(o.options.map((x) => x.type)).toEqual([
      'CONFIRMATION',
      'REMINDER',
      'RESCHEDULE',
      'CUSTOM',
    ]);
    const conf = o.options.find((x) => x.type === 'CONFIRMATION')!;
    expect(conf.preview).toContain('مرحباً Sara Khalil، تم تأكيد موعدك مع د. لينا');
    expect(conf.lastSentAt?.toISOString()).toBe('2030-05-01T10:00:00.000Z');
    const rem = o.options.find((x) => x.type === 'REMINDER')!;
    expect(rem.preview).toMatch(/نذكّركم بموعدكم غداً الساعة/);
    // Sending the confirmation produces exactly the previewed text.
    await send('CONFIRMATION');
    expect(
      substituteTemplateBody(
        FRAMES.appointment_confirmation_v2!,
        enqueued[0]!.parameters as string[],
      ),
    ).toBe(conf.preview);
  });

  it('EVENT / patient-less → no options, section hidden', async () => {
    state.appt = appt({ patient: null, patientId: null, appointmentType: 'EVENT' });
    const o = await getManualMessageOptions('a1');
    expect(o.hasPatient).toBe(false);
    expect(o.options).toEqual([]);
  });

  it('lastSentOfType queries the template family of the type (non-failed outbound only)', async () => {
    const { db } = await import('@/lib/db');
    state.lastSent = new Date('2030-05-02T10:00:00Z');
    const at = await lastSentOfType('a1', 'REMINDER');
    expect(at?.toISOString()).toBe('2030-05-02T10:00:00.000Z');
    const call = (
      db.whatsAppMessage.findFirst as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.at(-1)![0] as { where: Record<string, unknown> };
    expect(call.where).toMatchObject({
      appointmentId: 'a1',
      direction: 'OUTBOUND',
      status: { not: 'FAILED' },
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
