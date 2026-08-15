import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * PT-B4 item 3 — a submitted intake form must reach the desk.
 *
 * There was no notification here at all: the form landed in the queue in
 * silence and the sidebar count was the only signal. The rule that matters
 * most is that these are NEVER deduplicated — each submission is a different
 * person waiting, so collapsing repeats (as the home-program doctor-edit
 * notification deliberately does) would hide exactly what the desk must see.
 */

const m = vi.hoisted(() => ({
  staff: [] as Array<{ id: string }>,
  created: [] as Array<Record<string, unknown>>,
  createdRows: [] as Array<Record<string, unknown>>,
  failNext: false,
}));

vi.mock('@/auth', () => ({ auth: vi.fn(async () => null) }));
vi.mock('@/lib/impersonation/session', () => ({ getEffectiveSession: vi.fn(async () => null) }));
vi.mock('@/lib/patients/services', () => ({ createPatient: vi.fn() }));
vi.mock('@/lib/intake/services', () => ({
  createAdultIntake: vi.fn(),
  createPediatricIntake: vi.fn(),
}));
vi.mock('@/lib/notifications/actions', () => ({
  createNotification: vi.fn(async (args: Record<string, unknown>) => {
    if (m.failNext) {
      m.failNext = false;
      throw new Error('notification store unavailable');
    }
    m.created.push(args);
    return { id: `n-${m.created.length}` };
  }),
}));

vi.mock('@/lib/db', () => ({
  db: {
    intakeSubmission: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        m.createdRows.push(args.data);
        return { id: `sub-${m.createdRows.length}` };
      }),
    },
    user: { findMany: vi.fn(async () => m.staff) },
    auditLog: { create: vi.fn(async () => ({})) },
  },
  toLocalizedError: (e: unknown) => ({ code: 'ERR', message_en: String(e), message_ar: String(e) }),
}));

import { createPublicSubmission } from '../services';

const submission = (nameAr: string) =>
  ({
    type: 'ADULT' as const,
    locale: 'ar' as const,
    profile: {
      // P47 row 8 — the form's single name field (content-agnostic).
      fullNameEn: nameAr,
      phone: '0790000000',
      dateOfBirth: '1990-01-01',
      gender: 'MALE',
      address: '',
      email: '',
    },
    answers: {},
  }) as never;

beforeEach(() => {
  m.staff = [{ id: 'sec-1' }, { id: 'admin-1' }];
  m.created = [];
  m.createdRows = [];
  m.failNext = false;
});

describe('intake submission notifies reception', () => {
  it('notifies every secretary and admin, linking to the requests queue', async () => {
    await createPublicSubmission(submission('يوسف النجار'));

    expect(m.created).toHaveLength(2);
    expect(m.created.map((c) => c.recipientId).sort()).toEqual(['admin-1', 'sec-1']);
    expect(m.created[0]).toMatchObject({
      type: 'INTAKE_SUBMISSION_RECEIVED',
      params: { patientName: 'يوسف النجار' },
      linkPath: '/secretary/intake-submissions',
      relatedEntityType: 'IntakeSubmission',
    });
  });

  it('notifies for EVERY submission — the reported bug was the 2nd and 3rd going silent', async () => {
    await createPublicSubmission(submission('مريض أول'));
    await createPublicSubmission(submission('مريض ثانٍ'));
    await createPublicSubmission(submission('مريض ثالث'));

    // Three submissions × two staff — nothing is collapsed or skipped.
    expect(m.created).toHaveLength(6);
    expect(m.created.map((c) => (c.params as { patientName: string }).patientName)).toEqual([
      'مريض أول',
      'مريض أول',
      'مريض ثانٍ',
      'مريض ثانٍ',
      'مريض ثالث',
      'مريض ثالث',
    ]);
    // Each notification points at its own submission.
    expect(new Set(m.created.map((c) => c.relatedEntityId)).size).toBe(3);
  });

  it('still records the submission when the notification fails', async () => {
    // The patient already pressed send; a notification hiccup must not lose
    // their form.
    m.failNext = true;
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await createPublicSubmission(submission('مريض'));

    expect(res.submissionId).toBe('sub-1');
    expect(m.createdRows).toHaveLength(1);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('does not fail the submission when the clinic has no staff to notify', async () => {
    m.staff = [];
    const res = await createPublicSubmission(submission('مريض'));
    expect(res.submissionId).toBe('sub-1');
    expect(m.created).toHaveLength(0);
  });
});
