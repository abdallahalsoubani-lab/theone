import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Prompt 22 §2 + §3.1 — regression guard. A clinician-downloaded report
 * (session report, treatment plan) must NEVER contain the patient's phone
 * number or email. The source query shapes don't carry contact PII today,
 * but this test feeds the underlying lookups phone/email-bearing records and
 * asserts the rendered PDF text does not contain them — so a future schema
 * change that wires contact PII into a report fails CI instead of silently
 * leaking it.
 */

const PHONE = '0790SENTINELPHONE';
const EMAIL = 'sentinel.leak@example.com';

// No audit writes during the render (null effective session → actor null).
vi.mock('@/lib/impersonation/session', () => ({
  getEffectiveSession: vi.fn(async () => null),
}));

// Session note + its patient lookup. We deliberately attach `phone` to the
// returned objects even though the production select never asks for it.
vi.mock('@/lib/clinical/session-notes/queries', () => ({
  getSessionNoteById: vi.fn(async () => ({
    id: 'note1',
    appointmentId: 'appt1',
    patientId: 'pat1',
    therapistId: 'th1',
    therapistFullNameEn: 'Dr Therapist',
    therapistFullNameAr: 'المعالج',
    subjective: 'Patient reports lower-back pain.',
    objective: 'Limited flexion.',
    assessment: 'Lumbar strain.',
    plan: 'Continue mobilisation.',
    painScore: 4,
    measurementsText: 'ROM 40deg',
    parentNoteId: null,
    createdAt: new Date('2026-06-01T09:00:00Z'),
    updatedAt: new Date('2026-06-01T09:00:00Z'),
    isWithinEditWindow: false,
    phone: PHONE,
    email: EMAIL,
    addenda: [],
  })),
  getPrimaryNoteForAppointment: vi.fn(async () => null),
}));

vi.mock('@/lib/clinical/plans/queries', () => ({
  getPlanById: vi.fn(async () => ({
    id: 'plan1',
    patientId: 'pat1',
    patientFullNameEn: 'John Patient',
    patientFullNameAr: 'المريض',
    patientPhone: PHONE,
    patientEmail: EMAIL,
    doctorId: 'doc1',
    doctorFullNameEn: 'Dr Who',
    doctorFullNameAr: 'الطبيب',
    assignedTherapistId: 'th1',
    therapistFullNameEn: 'Dr Therapist',
    therapistFullNameAr: 'المعالج',
    diagnosisPrimary: 'Lumbar strain',
    diagnosisSecondary: null,
    goalsShortTerm: 'Reduce pain',
    goalsLongTerm: 'Full ROM',
    frequencyPerWeek: 3,
    durationWeeks: 6,
    status: 'ACTIVE',
    version: 1,
    parentPlanId: null,
    therapistNotes: 'Progressing well',
    proposalReason: null,
    rejectedReason: null,
    approvedAt: new Date('2026-06-01T09:00:00Z'),
    approvedById: 'doc1',
    createdAt: new Date('2026-06-01T09:00:00Z'),
    exercises: [
      {
        id: 'pe1',
        exerciseId: 'ex1',
        exerciseNameEn: 'Bridge',
        exerciseNameAr: 'الجسر',
        sets: 3,
        reps: 10,
        durationSeconds: 0,
        customNotes: null,
        order: 1,
      },
    ],
  })),
}));

// Patient lookup used by the session report — production select returns only
// names; we add `phone` + `email` to prove the renderer ignores them.
vi.mock('@/lib/db', () => ({
  db: {
    user: {
      findUnique: vi.fn(async () => ({
        fullNameEn: 'John Patient',
        fullNameAr: 'المريض',
        phone: PHONE,
        email: EMAIL,
      })),
    },
  },
  toLocalizedError: (e: unknown) => ({
    code: 'ERR',
    message_en: String(e),
    message_ar: String(e),
  }),
}));

import { generateSessionReportPdf } from '../sessionReport';
import { generateTreatmentPlanPdf } from '../treatmentPlan';

// CMap-aware text recovery — the PDFs embed a subsetted TrueType font
// (QA §2.4), so glyph runs must be translated through the ToUnicode CMap
// or the leak assertions would go blind.
import { extractPdfText } from './pdfText';

beforeEach(() => vi.clearAllMocks());

describe('report PDFs never leak patient contact PII', () => {
  it('session report contains no patient phone or email', async () => {
    const { buffer } = await generateSessionReportPdf({ noteId: 'note1', locale: 'en' });
    const text = extractPdfText(buffer);
    expect(text).not.toContain(PHONE);
    expect(text).not.toContain(EMAIL);
    // Sanity: the report DID render real content.
    expect(text).toContain('Lumbar');
  });

  it('treatment plan contains no patient phone or email', async () => {
    const { buffer } = await generateTreatmentPlanPdf({ planId: 'plan1', locale: 'en' });
    const text = extractPdfText(buffer);
    expect(text).not.toContain(PHONE);
    expect(text).not.toContain(EMAIL);
    expect(text).toContain('Bridge');
  });
});
