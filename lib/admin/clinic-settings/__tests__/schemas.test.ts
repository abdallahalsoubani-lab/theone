import { describe, expect, it } from 'vitest';

import { clinicSettingsUpdateSchema } from '../schemas';

/** P53 — the two lifecycle-delay fields: bounds + reminder fields untouched. */

const base = {
  nameEn: 'The One',
  nameAr: 'المركز الأول',
  phone: '+96261234567',
  addressEn: 'Amman',
  addressAr: 'عمان',
  defaultAppointmentDuration: 60,
  defaultReminderOffsetMinutes: 1440,
  reminderWindowStart: '08:00',
  reminderWindowEnd: '18:00',
  bookingConfirmationDelayMinutes: 0,
  rescheduleMessageDelayMinutes: 0,
  currentDelayMinutes: 10,
  sessionStartGraceMinutes: 15,
  sessionAutoCompleteGraceMinutes: 15,
  defaultLanguage: 'AR',
  hijriDefault: false,
  patientCanViewClinicalNotes: false,
  businessHours: Object.fromEntries(
    ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [
      d,
      { open: '09:00', close: '18:00', closed: d === 'fri' },
    ]),
  ),
  serviceTypes: [
    { id: 'st1', nameEn: 'Session', nameAr: 'جلسة', defaultDurationMinutes: 60, active: true },
  ],
};

describe('clinicSettingsUpdateSchema — P53 delay fields', () => {
  it('accepts 0 (the seeded default = immediate) and mid-range values', () => {
    expect(clinicSettingsUpdateSchema.safeParse(base).success).toBe(true);
    expect(
      clinicSettingsUpdateSchema.safeParse({
        ...base,
        bookingConfirmationDelayMinutes: 120,
        rescheduleMessageDelayMinutes: 60,
      }).success,
    ).toBe(true);
  });

  it('rejects out-of-bounds values (negative / >1440 / non-integer)', () => {
    expect(
      clinicSettingsUpdateSchema.safeParse({ ...base, bookingConfirmationDelayMinutes: -1 })
        .success,
    ).toBe(false);
    expect(
      clinicSettingsUpdateSchema.safeParse({ ...base, rescheduleMessageDelayMinutes: 1441 })
        .success,
    ).toBe(false);
    expect(
      clinicSettingsUpdateSchema.safeParse({ ...base, bookingConfirmationDelayMinutes: 5.5 })
        .success,
    ).toBe(false);
  });

  it('reminder settings keep their own bounds untouched (regression)', () => {
    expect(
      clinicSettingsUpdateSchema.safeParse({ ...base, defaultReminderOffsetMinutes: 1440 }).success,
    ).toBe(true);
    expect(
      clinicSettingsUpdateSchema.safeParse({ ...base, defaultReminderOffsetMinutes: 4 }).success,
    ).toBe(false);
  });
});
