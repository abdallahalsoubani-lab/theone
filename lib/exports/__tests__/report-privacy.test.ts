import zlib from 'node:zlib';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Prompt 22 §2 — regression guard. A clinician-downloaded report (session
 * report, treatment plan) must NEVER contain the patient's phone number. The
 * source query shapes don't carry phone today, but this test feeds the
 * underlying lookups a phone-bearing record and asserts the rendered PDF text
 * does not contain it — so a future schema change that wires the phone into a
 * report fails CI instead of silently leaking contact PII.
 */

const PHONE = '0790SENTINELPHONE';

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
// names; we add `phone` to prove the renderer ignores it.
vi.mock('@/lib/db', () => ({
  db: {
    user: {
      findUnique: vi.fn(async () => ({
        fullNameEn: 'John Patient',
        fullNameAr: 'المريض',
        phone: PHONE,
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

/** Decode the `<hexpairs>` glyph strings react-pdf emits in TJ operators. */
function decodeHexStrings(s: string): string {
  let out = '';
  for (const m of s.matchAll(/<([0-9A-Fa-f]+)>/g)) {
    const hex = m[1] ?? '';
    for (let i = 0; i + 1 < hex.length; i += 2) {
      out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    }
  }
  return out;
}

/**
 * All recoverable text from a PDF buffer: raw bytes, any inflated streams, and
 * the hex-encoded glyph strings inside the content-stream TJ operators (react-
 * pdf writes visible text as `<hex>` tokens, not literal ASCII).
 */
function extractText(buf: Buffer): string {
  let streams = '';
  const marker = Buffer.from('stream');
  let idx = 0;
  while ((idx = buf.indexOf(marker, idx)) !== -1) {
    let start = idx + marker.length;
    if (buf[start] === 0x0d) start++;
    if (buf[start] === 0x0a) start++;
    const end = buf.indexOf(Buffer.from('endstream'), start);
    if (end === -1) break;
    const slice = buf.subarray(start, end);
    try {
      streams += zlib.inflateSync(slice).toString('latin1');
    } catch {
      try {
        streams += zlib.inflateRawSync(slice).toString('latin1');
      } catch {
        streams += slice.toString('latin1'); // uncompressed content stream
      }
    }
    idx = end + 1;
  }
  const raw = buf.toString('latin1') + streams;
  return raw + decodeHexStrings(raw);
}

beforeEach(() => vi.clearAllMocks());

describe('report PDFs never leak the patient phone', () => {
  it('session report contains no patient phone', async () => {
    const { buffer } = await generateSessionReportPdf({ noteId: 'note1', locale: 'en' });
    const text = extractText(buffer);
    expect(text).not.toContain(PHONE);
    // Sanity: the report DID render real content.
    expect(text).toContain('Lumbar');
  });

  it('treatment plan contains no patient phone', async () => {
    const { buffer } = await generateTreatmentPlanPdf({ planId: 'plan1', locale: 'en' });
    const text = extractText(buffer);
    expect(text).not.toContain(PHONE);
    expect(text).toContain('Bridge');
  });
});
