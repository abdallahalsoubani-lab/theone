import { AppointmentStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Prompt 48b §3.6 — the Unconfirmed list query: reminded-only scope, the
 * derived reply grouping (CONFIRMED / DECLINED / NONE), the badge count, and
 * the RBAC gate (secretary/admin only — no doctor, no therapist).
 */

vi.mock('@/lib/db', () => {
  const state = {
    appts: [] as Array<Record<string, unknown>>,
    messages: [] as Array<Record<string, unknown>>,
  };
  return {
    __state: state,
    db: {
      appointment: { findMany: vi.fn(async () => state.appts) },
      whatsAppMessage: { findMany: vi.fn(async () => state.messages) },
    },
  };
});

import {
  canSeeConfirmationsList,
  countUnconfirmedReminders,
  listReminderConfirmations,
} from '../confirmations';

const { __state } = (await import('@/lib/db')) as unknown as {
  __state: { appts: Array<Record<string, unknown>>; messages: Array<Record<string, unknown>> };
};

const NOW = new Date('2026-08-01T10:00:00Z');
const PATIENT = { id: 'p1', fullNameEn: 'Sara', fullNameAr: 'سارة', phone: '+962790000001' };

function appt(id: string, status: AppointmentStatus = AppointmentStatus.SCHEDULED) {
  return {
    id,
    startsAt: new Date('2026-08-02T08:00:00Z'),
    durationMinutes: 30,
    seriesId: null,
    status,
    patient: PATIENT,
    therapists: [{ therapist: { fullNameEn: 'Dr. L', fullNameAr: 'د. ل' } }],
  };
}
const reminder = (appointmentId: string) => ({
  appointmentId,
  direction: 'OUTBOUND',
  intent: null,
  sentAt: new Date('2026-08-01T08:00:00Z'),
});
const inbound = (appointmentId: string, intent: 'CONFIRM' | 'CANCEL_REQUEST') => ({
  appointmentId,
  direction: 'INBOUND',
  intent,
  sentAt: new Date('2026-08-01T09:00:00Z'),
});

beforeEach(() => {
  __state.appts.length = 0;
  __state.messages.length = 0;
});

describe('listReminderConfirmations', () => {
  it('groups reminded appointments by derived reply state', async () => {
    __state.appts.push(
      appt('a-none'),
      appt('a-conf', AppointmentStatus.CONFIRMED),
      appt('a-decl'),
      appt('a-text-conf'),
    );
    __state.messages.push(
      reminder('a-none'),
      reminder('a-conf'),
      reminder('a-decl'),
      reminder('a-text-conf'),
      inbound('a-decl', 'CANCEL_REQUEST'),
      // still-SCHEDULED but the patient texted a confirm → CONFIRMED group.
      inbound('a-text-conf', 'CONFIRM'),
    );
    const rows = await listReminderConfirmations(NOW);
    const byId = new Map(rows.map((r) => [r.appointmentId, r.replyState]));
    expect(byId.get('a-none')).toBe('NONE');
    expect(byId.get('a-conf')).toBe('CONFIRMED');
    expect(byId.get('a-decl')).toBe('DECLINED');
    expect(byId.get('a-text-conf')).toBe('CONFIRMED');
  });

  it('appointments with NO reminder sent are excluded (reminded-only scope)', async () => {
    __state.appts.push(appt('a-reminded'), appt('a-silent'));
    __state.messages.push(reminder('a-reminded'));
    const rows = await listReminderConfirmations(NOW);
    expect(rows.map((r) => r.appointmentId)).toEqual(['a-reminded']);
  });

  it('a CONFIRM inbound beats an earlier decline; badge counts NONE only', async () => {
    __state.appts.push(appt('a1'), appt('a2'));
    __state.messages.push(
      reminder('a1'),
      reminder('a2'),
      inbound('a1', 'CANCEL_REQUEST'),
      inbound('a1', 'CONFIRM'),
    );
    const rows = await listReminderConfirmations(NOW);
    expect(rows.find((r) => r.appointmentId === 'a1')?.replyState).toBe('CONFIRMED');
    expect(await countUnconfirmedReminders(NOW)).toBe(1); // only a2
  });
});

describe('canSeeConfirmationsList (RBAC)', () => {
  it('secretary + admin only — doctor and therapist are refused', () => {
    expect(canSeeConfirmationsList('SECRETARY')).toBe(true);
    expect(canSeeConfirmationsList('ADMIN')).toBe(true);
    expect(canSeeConfirmationsList('DOCTOR')).toBe(false);
    expect(canSeeConfirmationsList('THERAPIST')).toBe(false);
    expect(canSeeConfirmationsList('PATIENT')).toBe(false);
  });
});
