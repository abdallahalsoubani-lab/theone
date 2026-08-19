import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P50 (revised) §5.3 — the duplicate-phone check on patient CREATE is a
 * WARNING, not a block: the first submit without `confirmSharedPhone` fails
 * with PATIENT_PHONE_SHARED_CONFIRM naming the existing holder; resubmitting
 * with the flag persists the record (13 roster families legitimately share
 * one number).
 */

const state = {
  holder: null as { fullNameEn: string; fullNameAr: string } | null,
  created: [] as Array<Record<string, unknown>>,
};

vi.mock('@/lib/audit/withAudit', () => ({
  // Pass-through: audit wiring is covered by its own tests.
  withAudit: (_cfg: unknown, fn: (...args: never[]) => unknown) => fn,
}));

vi.mock('@/lib/db', () => {
  const tx = {
    user: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.created.push(data);
        return { id: 'new-patient', phone: (data.phone as string | null) ?? null };
      }),
    },
    patientProfile: { create: vi.fn(async () => ({})) },
  };
  return {
    db: {
      user: {
        findFirst: vi.fn(
          async ({ where }: { where: { phone?: string; email?: string } }) =>
            where.phone ? state.holder : null, // email pre-check finds nothing
        ),
      },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    },
    toLocalizedError: (e: unknown) => e,
  };
});

vi.mock('@/lib/auth/password', () => ({ hashPassword: vi.fn(async () => 'hashed') }));
vi.mock('@/lib/admin/temp-password', () => ({ generateTempPassword: () => 'Temp@1234' }));
vi.mock('@/lib/whatsapp/templates/sendCredentials', () => ({
  sendPatientCredentials: vi.fn(async () => ({ skipped: false })),
}));

import { createPatient, PatientAdminError } from '../services';

const input = {
  fullNameEn: 'Sara Khalil',
  phone: '+962791234567',
  email: null,
  dateOfBirth: new Date('2000-01-01T00:00:00Z'),
  gender: 'FEMALE' as const,
  nationalId: null,
  address: '',
  occupation: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
  languagePref: 'AR' as const,
  hijriCalendarPref: false,
  medicalHistorySummary: null,
  allergies: null,
  currentMedications: null,
  confirmSharedPhone: false,
};

describe('createPatient — shared-phone warning (P50 §5.3)', () => {
  beforeEach(() => {
    state.holder = null;
    state.created = [];
  });

  it('warns (does not silently create) when the number belongs to an existing patient', async () => {
    state.holder = { fullNameEn: 'Rana Khalil', fullNameAr: '' };
    await expect(createPatient(input, 'actor-1')).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(PatientAdminError);
      const e = err as PatientAdminError;
      expect(e.error.code).toBe('PATIENT_PHONE_SHARED_CONFIRM');
      // The warning names the current holder so the Secretary can decide.
      expect(e.error.message_en).toContain('Rana Khalil');
      expect(e.error.message_ar).toContain('Rana Khalil');
      return true;
    });
    expect(state.created).toHaveLength(0);
  });

  it('creates when the shared number is explicitly confirmed', async () => {
    state.holder = { fullNameEn: 'Rana Khalil', fullNameAr: '' };
    const result = await createPatient({ ...input, confirmSharedPhone: true }, 'actor-1');
    expect(result.patientId).toBe('new-patient');
    expect(state.created).toHaveLength(1);
  });

  it('creates without any prompt when the number is free', async () => {
    const result = await createPatient(input, 'actor-1');
    expect(result.patientId).toBe('new-patient');
    expect(state.created).toHaveLength(1);
  });
});
