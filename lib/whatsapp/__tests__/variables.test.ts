import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Prompt 48b §3.5 — registry-driven template variables. The SID switch is a
 * pure Admin operation because the parameter array is built from the row's
 * stored shape; these tests pin the old-vs-v2 duality and the clinic-TZ
 * day-name (the institutional timezone trap: process runs under TZ=UTC).
 */

const { shapeRef } = vi.hoisted(() => ({
  shapeRef: { current: null as unknown },
}));
vi.mock('@/lib/db', () => ({
  db: {
    whatsAppTemplate: {
      findUnique: vi.fn(async () => ({ variablesShape: shapeRef.current })),
    },
  },
}));
vi.mock('@/lib/time/clinic-server', () => ({
  getClinicTimeZone: vi.fn(async () => 'Asia/Amman'),
}));

import { clinicWeekdayName } from '@/lib/time/clinic';

import {
  appointmentVarContext,
  buildParamsFromShape,
  parseVariablesShape,
  resolveTemplateShape,
} from '../templates/variables';

beforeEach(() => {
  shapeRef.current = null;
});

// 2026-08-01T22:30Z = Sunday 2026-08-02 01:30 in Amman (+3) — the UTC day
// is still Saturday. The day name MUST come from the clinic wall clock.
const AMMAN_EVENING = new Date('2026-08-01T22:30:00Z');

describe('clinicWeekdayName — the TZ trap (rule #1)', () => {
  it('renders the AMMAN weekday, not the UTC one, under TZ=UTC test env', () => {
    expect(clinicWeekdayName(AMMAN_EVENING, 'en', 'Asia/Amman')).toBe('Sunday');
    expect(clinicWeekdayName(AMMAN_EVENING, 'ar', 'Asia/Amman')).toBe('الأحد');
  });
});

describe('dual template shapes — zero-deploy switch', () => {
  const ctxArgs = {
    startsAt: AMMAN_EVENING,
    patientName: 'سارة خليل',
    therapistName: 'د. لينا',
    language: 'AR' as const,
  };

  it('row WITHOUT a stored shape → the legacy hardcoded order (current live SIDs)', async () => {
    shapeRef.current = null;
    const shape = await resolveTemplateShape('appointment_reminder_v2', 'AR');
    expect(shape).toEqual(['therapistName', 'time', 'date']);
    const ctx = await appointmentVarContext(ctxArgs);
    expect(buildParamsFromShape(shape!, ctx)).toEqual(['د. لينا', '01:30', '2026-08-02']);
  });

  it('row WITH the v2 shape → [patient, dayName, date, time] — no deploy in between', async () => {
    shapeRef.current = ['patientName', 'dayName', 'date', 'time'];
    const shape = await resolveTemplateShape('appointment_reminder_v2', 'AR');
    const ctx = await appointmentVarContext(ctxArgs);
    expect(buildParamsFromShape(shape!, ctx)).toEqual([
      'سارة خليل',
      'الأحد',
      '2026-08-02',
      '01:30',
    ]);
  });

  it('malformed stored shapes fall back to legacy, unknown templates return null', async () => {
    expect(parseVariablesShape({ not: 'an array' } as never)).toBeNull();
    expect(parseVariablesShape(['patientName', 'bogusToken'] as never)).toBeNull();
    shapeRef.current = 'garbage';
    expect(await resolveTemplateShape('appointment_reminder_v2', 'AR')).toEqual([
      'therapistName',
      'time',
      'date',
    ]);
    expect(await resolveTemplateShape('never_registered_template', 'AR')).toBeNull();
  });
});
