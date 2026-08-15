import { describe, expect, it } from 'vitest';

import {
  appointmentCancelSchema,
  appointmentChangeTherapistSchema,
  appointmentRescheduleSchema,
} from '../schemas';

/**
 * Prompt 45 rows 1+2 — edits to a series member apply to THAT occurrence
 * only. The series-scope field was removed from the reschedule and
 * change-therapist schemas entirely, so an old client (or a crafted
 * request) sending `seriesMode: 'ALL'` cannot mass-edit: Zod strips the
 * unknown key and the action only ever calls the single-appointment
 * service. Cancel is NOT an edit — its scope options survive.
 */

const reschedInput = {
  id: 'appt-1',
  startsAt: '2026-08-20T08:00:00.000Z',
  durationMinutes: 60,
};

const changeTherapistInput = {
  id: 'appt-1',
  therapistIds: ['th-1'],
};

const cancelInput = {
  id: 'appt-1',
  cancellationCategory: 'PATIENT_REQUEST',
  cancellationReason: 'patient asked',
};

describe('reschedule schema — the mass-edit hole is closed', () => {
  it('parses without any series scope field', () => {
    const parsed = appointmentRescheduleSchema.parse(reschedInput);
    expect('seriesMode' in parsed).toBe(false);
  });

  for (const smuggled of ['ONE', 'FOLLOWING', 'ALL']) {
    it(`strips a smuggled seriesMode: '${smuggled}' instead of honoring it`, () => {
      const parsed = appointmentRescheduleSchema.parse({
        ...reschedInput,
        seriesMode: smuggled,
      });
      expect('seriesMode' in parsed).toBe(false);
    });
  }
});

describe('change-therapist schema — the mass-edit hole is closed', () => {
  it('parses without any series scope field', () => {
    const parsed = appointmentChangeTherapistSchema.parse(changeTherapistInput);
    expect('seriesMode' in parsed).toBe(false);
  });

  it("strips a smuggled seriesMode: 'ALL' instead of honoring it", () => {
    const parsed = appointmentChangeTherapistSchema.parse({
      ...changeTherapistInput,
      seriesMode: 'ALL',
    });
    expect('seriesMode' in parsed).toBe(false);
  });
});

describe('cancel schema — series scopes survive (cancel is not an edit)', () => {
  it('defaults to ONE', () => {
    expect(appointmentCancelSchema.parse(cancelInput).seriesMode).toBe('ONE');
  });

  it('still accepts FOLLOWING and ALL', () => {
    expect(
      appointmentCancelSchema.parse({ ...cancelInput, seriesMode: 'FOLLOWING' }).seriesMode,
    ).toBe('FOLLOWING');
    expect(appointmentCancelSchema.parse({ ...cancelInput, seriesMode: 'ALL' }).seriesMode).toBe(
      'ALL',
    );
  });
});
