import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Prompt 22 QA §2.4 — regression guard. Every PDF the system emits used the
 * standard-14 'Helvetica' font, which has zero Arabic glyphs: pdfkit silently
 * truncated each Arabic codepoint to its low byte and every Arabic string
 * rendered as mojibake. The fix registers the vendored IBM Plex Sans Arabic
 * TTFs (lib/exports/fonts.ts) as the single family for all four generators.
 *
 * These smoke tests render each PDF type in both locales with mixed
 * Arabic + English content and assert:
 *   - the render resolves and produces a real, non-trivial PDF;
 *   - the embedded font is an IBMPlexSansArabic subset (a TrueType
 *     'FontFile2' program) and Helvetica is gone — any stylesheet reverting
 *     to 'Helvetica' fails here;
 *   - the Arabic renders carry Arabic codepoints in the ToUnicode CMap and
 *     the recovered text contains real Arabic words;
 *   - the English renders still contain their Latin text (IBM Plex Sans
 *     Arabic covers Latin glyphs — verified here, not assumed).
 */

// No audit writes during the render (null effective session → actor null).
vi.mock('@/lib/impersonation/session', () => ({
  getEffectiveSession: vi.fn(async () => null),
}));

vi.mock('@/lib/clinical/session-notes/queries', () => ({
  getSessionNoteById: vi.fn(async () => ({
    id: 'note1',
    appointmentId: 'appt1',
    patientId: 'pat1',
    therapistId: 'th1',
    therapistFullNameEn: 'Dr Therapist',
    therapistFullNameAr: 'المعالج',
    subjective: 'Patient reports lower-back pain. يشكو المريض من ألم أسفل الظهر',
    objective: 'Limited flexion.',
    assessment: 'Lumbar strain.',
    plan: 'Continue mobilisation.',
    painScore: 4,
    measurementsText: 'ROM 40deg',
    parentNoteId: null,
    createdAt: new Date('2026-06-01T09:00:00Z'),
    updatedAt: new Date('2026-06-01T09:00:00Z'),
    isWithinEditWindow: false,
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

vi.mock('@/lib/pediatric-assessment/queries', () => ({
  getAssessmentById: vi.fn(async () => ({
    id: 'as1',
    patientId: 'pat1',
    coreData: { date: '2026-06-01', childName: 'John Patient', tone: 'Normal tone' },
    customData: {},
    createdAt: new Date('2026-06-01T09:00:00Z'),
    updatedAt: new Date('2026-06-01T09:00:00Z'),
    createdByNameEn: 'Dr Who',
    createdByNameAr: 'الطبيب',
    updatedByNameEn: null,
    updatedByNameAr: null,
  })),
}));

vi.mock('@/lib/pediatric-assessment/customFields/queries', () => ({
  listFieldsForAssessment: vi.fn(async () => []),
}));

vi.mock('@/lib/patients/queries', () => ({
  getPatientFile: vi.fn(async () => ({
    id: 'pat1',
    fullNameEn: 'John Patient',
    fullNameAr: 'المريض',
    phone: '0790000000',
    email: 'john@example.com',
    dateOfBirth: new Date('1990-01-15T00:00:00Z'),
    gender: 'MALE',
    address: 'Amman — شارع المدينة',
  })),
}));

vi.mock('@/lib/db', () => ({
  db: {
    user: {
      findUnique: vi.fn(async () => ({
        fullNameEn: 'John Patient',
        fullNameAr: 'المريض',
        patientProfile: { dateOfBirth: new Date('2020-01-15T00:00:00Z') },
      })),
    },
    appointment: {
      findMany: vi.fn(async () => [
        {
          id: 'a1',
          startsAt: new Date('2026-06-01T09:00:00Z'),
          durationMinutes: 45,
          status: 'COMPLETED',
          therapists: [{ therapist: { fullNameEn: 'Dr Therapist', fullNameAr: 'المعالج' } }],
        },
      ]),
    },
    intakeAssessment: {
      findFirst: vi.fn(async () => ({
        createdAt: new Date('2026-05-01T09:00:00Z'),
        adultData: { primaryComplaint: 'Lower back pain — ألم أسفل الظهر' },
      })),
    },
    treatmentPlan: {
      findMany: vi.fn(async () => [
        {
          id: 'plan1',
          diagnosisPrimary: 'Lumbar strain',
          status: 'ACTIVE',
          createdAt: new Date('2026-06-01T09:00:00Z'),
        },
      ]),
    },
    sessionNote: { count: vi.fn(async () => 3) },
    homeProgramItem: {
      findMany: vi.fn(async () => [{ id: 'h1', exercise: { nameEn: 'Bridge', nameAr: 'الجسر' } }]),
    },
    auditLog: { count: vi.fn(async () => 7), create: vi.fn(async () => ({})) },
  },
  toLocalizedError: (e: unknown) => ({
    code: 'ERR',
    message_en: String(e),
    message_ar: String(e),
  }),
}));

import { generatePatientFilePdf } from '../patientFile';
import { generatePediatricAssessmentPdf } from '../pediatricAssessment';
import { generateSessionReportPdf } from '../sessionReport';
import { generateTreatmentPlanPdf } from '../treatmentPlan';

import { containsWordEitherDirection, extractPdfText } from './pdfText';

type Locale = 'en' | 'ar';

const generators: Array<{
  name: string;
  render: (locale: Locale) => Promise<Buffer>;
  latinSample: string;
  /** Ligature-free Arabic word expected in the AR render (see pdfText.ts). */
  arabicSample: string;
}> = [
  {
    name: 'patient file',
    render: async (locale) =>
      (
        await generatePatientFilePdf({
          patientId: 'pat1',
          requester: { id: 'admin1', role: 'ADMIN' },
          locale,
        })
      ).buffer,
    latinSample: 'Bridge',
    arabicSample: 'المريض',
  },
  {
    name: 'pediatric assessment',
    render: async (locale) =>
      (await generatePediatricAssessmentPdf({ assessmentId: 'as1', locale })).buffer,
    latinSample: 'Physiotherapy',
    arabicSample: 'المركز',
  },
  {
    name: 'session report',
    render: async (locale) => (await generateSessionReportPdf({ noteId: 'note1', locale })).buffer,
    latinSample: 'Lumbar',
    arabicSample: 'المركز',
  },
  {
    name: 'treatment plan',
    render: async (locale) => (await generateTreatmentPlanPdf({ planId: 'plan1', locale })).buffer,
    latinSample: 'Bridge',
    arabicSample: 'المركز',
  },
];

beforeEach(() => vi.clearAllMocks());

describe.each(generators)('$name PDF', ({ render, latinSample, arabicSample }) => {
  it.each<Locale>(['en', 'ar'])(
    'renders a real PDF with the embedded font (%s)',
    async (locale) => {
      const buffer = await render(locale);

      expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(buffer.length).toBeGreaterThan(1000);

      const raw = buffer.toString('latin1');
      // The Arabic-incapable standard-14 font must be gone for good…
      expect(raw).not.toContain('Helvetica');
      // …replaced by an embedded IBM Plex Sans Arabic TrueType subset.
      expect(raw).toContain('IBMPlexSansArabic');
      expect(raw).toContain('FontFile2');
    },
  );

  it('English render keeps its Latin text (family covers Latin)', async () => {
    const text = extractPdfText(await render('en'));
    expect(text).toContain(latinSample);
  });

  it('Arabic render maps real Arabic codepoints, not mojibake', async () => {
    const text = extractPdfText(await render('ar'));
    // The embedded subset's ToUnicode CMap carries Arabic-block codepoints
    // (U+06xx as UTF-16BE hex) — Helvetica output had none.
    expect(text).toMatch(/<06[0-9A-Fa-f]{2}>/);
    // And the recovered visible text contains the expected Arabic word
    // (visual or logical order — the bidi engine stores RTL runs visually).
    expect(containsWordEitherDirection(text, arabicSample)).toBe(true);
  });
});
