import { AuditAction } from '@prisma/client';

import { withAudit } from '@/lib/audit/withAudit';
import {
  getPrimaryNoteForAppointment,
  getSessionNoteById,
} from '@/lib/clinical/session-notes/queries';
import { db, toLocalizedError, type LocalizedError } from '@/lib/db';

import { ReportDocument, renderReportToBuffer, type ReportSection } from './reportLayout';

/**
 * Session report PDF (Prompt 22 §2). Renders a single SOAP session note (plus
 * any addenda) for a clinician download.
 *
 * Privacy: the source `SessionNoteRow` carries NO patient phone, and the only
 * extra lookup here selects the patient's name — never the phone. A clinician-
 * downloaded report must never leak contact PII (enforced by a regression test).
 */

export class SessionReportError extends Error {
  constructor(public readonly error: LocalizedError) {
    super(error.message_en);
    this.name = 'SessionReportError';
  }
}

const NOT_FOUND: LocalizedError = {
  code: 'SESSION_NOTE_NOT_FOUND',
  message_en: 'This session note no longer exists.',
  message_ar: 'لم تعد ملاحظة الجلسة هذه موجودة.',
};

export function sessionReportErrorToLocalized(err: unknown): LocalizedError {
  if (err instanceof SessionReportError) return err.error;
  return toLocalizedError(err);
}

interface Args {
  noteId: string;
  locale: 'en' | 'ar';
}

function dt(d: Date): string {
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`;
}

const generateInner = async ({
  noteId,
  locale,
}: Args): Promise<{ buffer: Buffer; patientId: string }> => {
  const ar = locale === 'ar';
  const note = await getSessionNoteById(noteId);
  if (!note) throw new SessionReportError(NOT_FOUND);

  // Pull addenda alongside the primary, if this note is the primary.
  const full = await getPrimaryNoteForAppointment(note.appointmentId);
  const addenda = full && full.id === note.id ? full.addenda : [];

  const patient = await db.user.findUnique({
    where: { id: note.patientId },
    select: { fullNameEn: true, fullNameAr: true },
  });
  const patientName = patient ? (ar ? patient.fullNameAr : patient.fullNameEn) : note.patientId;
  const therapistName = ar ? note.therapistFullNameAr : note.therapistFullNameEn;

  const meta = [
    `${ar ? 'المراجع' : 'Patient'}: ${patientName}`,
    `${ar ? 'المعالج' : 'Therapist'}: ${therapistName}`,
    `${ar ? 'التاريخ' : 'Date'}: ${dt(note.createdAt)}`,
  ].join('  ·  ');

  const sections: ReportSection[] = [
    {
      heading: ar ? 'معلومات الجلسة' : 'Session info',
      rows: [
        {
          label: ar ? 'درجة الألم' : 'Pain score',
          value: note.painScore != null ? `${note.painScore} / 10` : '—',
        },
        { label: ar ? 'القياسات' : 'Measurements', value: note.measurementsText || '—' },
      ],
    },
    { heading: ar ? 'الشكوى (S)' : 'Subjective (S)', body: note.subjective },
    { heading: ar ? 'الفحص (O)' : 'Objective (O)', body: note.objective },
    { heading: ar ? 'التقييم (A)' : 'Assessment (A)', body: note.assessment },
    { heading: ar ? 'الخطة (P)' : 'Plan (P)', body: note.plan },
  ];

  for (const a of addenda) {
    sections.push({
      heading: `${ar ? 'إضافة' : 'Addendum'} — ${dt(a.createdAt)}`,
      body: [a.subjective, a.objective, a.assessment, a.plan].filter(Boolean).join('\n'),
    });
  }

  const title = ar ? 'تقرير الجلسة' : 'Session report';
  const buffer = await renderReportToBuffer(
    <ReportDocument ar={ar} title={title} meta={meta} sections={sections} />,
  );
  return { buffer, patientId: note.patientId };
};

export const generateSessionReportPdf = withAudit<[Args], { buffer: Buffer; patientId: string }>(
  {
    entityType: 'SessionNote',
    action: AuditAction.READ_SENSITIVE,
    extractEntityId: (_args, result) => result.patientId,
    extractAfter: () => ({ event: 'SESSION_REPORT_EXPORTED' }),
  },
  generateInner,
);
