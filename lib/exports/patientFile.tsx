import { AuditAction, type AppointmentStatus } from '@prisma/client';
import { Document, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer';

import { withAudit } from '@/lib/audit/withAudit';
import { db, toLocalizedError, type LocalizedError } from '@/lib/db';
import { getPatientFile } from '@/lib/patients/queries';
import { type PermissionUser } from '@/lib/rbac/can';

import { resolveRedaction, type ExportRedaction } from './redaction';

export { resolveRedaction, type ExportRedaction };

/**
 * Patient data export — PDF generator (Prompt 11 §4.3).
 *
 * Right-of-access (Spec §13): patients can download their full
 * record. Clinical staff get the same shape plus assessment +
 * session-note summaries. Admin additionally sees an audit summary.
 *
 * Redaction levels:
 *   - SELF       — profile + intake responses (no clinical assessments)
 *                  + appointments + home program.
 *   - CLINICAL   — adds treatment plan summary + session note summary.
 *   - ADMIN      — adds audit summary (last 100 actions on this patient).
 *
 * Audited as `READ_SENSITIVE` whether the requester is the patient,
 * a clinician, or an Admin — every export touches PHI.
 */

export interface GeneratePatientFileArgs {
  patientId: string;
  requester: PermissionUser;
  locale: 'en' | 'ar';
}

export class PatientExportError extends Error {
  constructor(public readonly error: LocalizedError) {
    super(error.message_en);
    this.name = 'PatientExportError';
  }
}

const notFound: LocalizedError = {
  code: 'PATIENT_NOT_FOUND',
  message_en: 'Patient not found.',
  message_ar: 'لم يتم العثور على المريض.',
};

const forbidden: LocalizedError = {
  code: 'EXPORT_FORBIDDEN',
  message_en: 'You do not have permission to export this patient file.',
  message_ar: 'لا تملك صلاحية تصدير ملف هذا المريض.',
};

interface PdfInputs {
  redaction: ExportRedaction;
  locale: 'en' | 'ar';
  patient: NonNullable<Awaited<ReturnType<typeof getPatientFile>>>;
  appointments: Array<{
    id: string;
    startsAt: Date;
    durationMinutes: number;
    status: AppointmentStatus;
    therapistFullNameEn: string;
    therapistFullNameAr: string;
  }>;
  intake: { primaryComplaint: string | null; createdAt: Date } | null;
  plans: Array<{ id: string; diagnosisPrimary: string; status: string; createdAt: Date }>;
  noteCount: number;
  homeProgram: Array<{ id: string; exerciseNameEn: string; exerciseNameAr: string }>;
  auditCount: number;
}

const generatePatientFilePdfInner = async ({
  patientId,
  requester,
  locale,
}: GeneratePatientFileArgs): Promise<{ buffer: Buffer; patientId: string }> => {
  const redaction = resolveRedaction(requester, patientId);
  if (!redaction) throw new PatientExportError(forbidden);

  const patient = await getPatientFile(patientId);
  if (!patient) throw new PatientExportError(notFound);

  const [appointments, intake, plans, noteCount, homeProgram, auditCount] = await Promise.all([
    db.appointment.findMany({
      where: { patientId },
      orderBy: { startsAt: 'desc' },
      take: 200,
      select: {
        id: true,
        startsAt: true,
        durationMinutes: true,
        status: true,
        therapist: { select: { fullNameEn: true, fullNameAr: true } },
      },
    }),
    db.intakeAssessment
      .findFirst({
        where: { patientId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, adultData: { select: { primaryComplaint: true } } },
      })
      .then((r) =>
        r
          ? { primaryComplaint: r.adultData?.primaryComplaint ?? null, createdAt: r.createdAt }
          : null,
      ),
    redaction === 'SELF'
      ? Promise.resolve([])
      : db.treatmentPlan.findMany({
          where: { patientId },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: { id: true, diagnosisPrimary: true, status: true, createdAt: true },
        }),
    redaction === 'SELF' ? Promise.resolve(0) : db.sessionNote.count({ where: { patientId } }),
    db.homeProgramItem.findMany({
      where: { patientId, active: true },
      take: 50,
      select: {
        id: true,
        exercise: { select: { nameEn: true, nameAr: true } },
      },
    }),
    redaction === 'ADMIN'
      ? db.auditLog.count({ where: { entityType: 'PatientProfile', entityId: patientId } })
      : Promise.resolve(0),
  ]);

  const inputs: PdfInputs = {
    redaction,
    locale,
    patient,
    appointments: appointments.map((a) => ({
      id: a.id,
      startsAt: a.startsAt,
      durationMinutes: a.durationMinutes,
      status: a.status,
      therapistFullNameEn: a.therapist.fullNameEn,
      therapistFullNameAr: a.therapist.fullNameAr,
    })),
    intake,
    plans,
    noteCount,
    homeProgram: homeProgram.map((h) => ({
      id: h.id,
      exerciseNameEn: h.exercise.nameEn,
      exerciseNameAr: h.exercise.nameAr,
    })),
    auditCount,
  };

  // react-pdf `toBuffer()` returns a Node Readable stream; collect it
  // into a single Buffer before handing to the route handler.
  const stream = await pdf(<PatientFilePdf inputs={inputs} />).toBuffer();
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    (stream as unknown as NodeJS.ReadableStream).on('data', (c: Buffer) => chunks.push(c));
    (stream as unknown as NodeJS.ReadableStream).on('end', () => resolve());
    (stream as unknown as NodeJS.ReadableStream).on('error', reject);
  });
  return { buffer: Buffer.concat(chunks), patientId };
};

export const generatePatientFilePdf = withAudit<
  [GeneratePatientFileArgs],
  { buffer: Buffer; patientId: string }
>(
  {
    entityType: 'PatientProfile',
    action: AuditAction.READ_SENSITIVE,
    extractEntityId: (args) => args[0].patientId,
    extractAfter: () => ({ event: 'PATIENT_FILE_EXPORTED' }),
  },
  generatePatientFilePdfInner,
);

export function exportErrorToLocalized(err: unknown): LocalizedError {
  if (err instanceof PatientExportError) return err.error;
  return toLocalizedError(err);
}

// ─── PDF document ─────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  page: { padding: 36, fontFamily: 'Helvetica', fontSize: 10, color: '#212940' },
  header: {
    marginBottom: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#D8DEE8',
  },
  clinicName: { fontSize: 16, fontWeight: 700, color: '#212940' },
  generated: { fontSize: 9, color: '#5A6580', marginTop: 4 },
  section: { marginTop: 14 },
  h2: { fontSize: 12, fontWeight: 700, color: '#0EA5B7', marginBottom: 4 },
  row: { flexDirection: 'row', marginBottom: 2 },
  rowLabel: { width: 110, color: '#5A6580' },
  rowValue: { flex: 1 },
  table: { borderTopWidth: 1, borderTopColor: '#D8DEE8', marginTop: 4 },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#D8DEE8',
    paddingVertical: 3,
  },
  td: { flex: 1, paddingHorizontal: 4 },
  tdSmall: { width: 80, paddingHorizontal: 4 },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 36,
    right: 36,
    fontSize: 8,
    color: '#5A6580',
    textAlign: 'center',
  },
});

function PatientFilePdf({ inputs }: { inputs: PdfInputs }) {
  const {
    patient,
    locale,
    redaction,
    appointments,
    intake,
    plans,
    noteCount,
    homeProgram,
    auditCount,
  } = inputs;
  const ar = locale === 'ar';
  const name = ar ? patient.fullNameAr : patient.fullNameEn;
  return (
    <Document title={`Patient file — ${patient.fullNameEn}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.clinicName}>Theone.pt — {ar ? 'ملف المريض' : 'Patient File'}</Text>
          <Text style={styles.generated}>
            {ar ? 'تم التوليد' : 'Generated'}: {new Date().toISOString()} ·{' '}
            {ar ? 'النطاق' : 'Scope'}: {redaction}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.h2}>{ar ? 'البيانات الشخصية' : 'Profile'}</Text>
          <Row label={ar ? 'الاسم' : 'Name'} value={name} />
          {/* Phone is null in a CLINICAL (Doctor/Therapist) export — getPatientFile
              hides it at the data layer (Prompt 15 §1); SELF/ADMIN exports keep it. */}
          <Row label={ar ? 'الهاتف' : 'Phone'} value={patient.phone ?? (ar ? 'مخفي' : 'Hidden')} />
          <Row label={ar ? 'البريد' : 'Email'} value={patient.email ?? '—'} />
          <Row
            label={ar ? 'تاريخ الميلاد' : 'Date of birth'}
            value={patient.dateOfBirth.toISOString().slice(0, 10)}
          />
          <Row label={ar ? 'الجنس' : 'Gender'} value={patient.gender} />
          <Row label={ar ? 'العنوان' : 'Address'} value={patient.address ?? '—'} />
        </View>

        {intake ? (
          <View style={styles.section}>
            <Text style={styles.h2}>{ar ? 'تقييم القبول' : 'Intake'}</Text>
            <Row
              label={ar ? 'تاريخ' : 'Date'}
              value={intake.createdAt.toISOString().slice(0, 10)}
            />
            <Row
              label={ar ? 'الشكوى' : 'Primary complaint'}
              value={intake.primaryComplaint ?? '—'}
            />
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.h2}>{ar ? 'المواعيد' : 'Appointments'}</Text>
          <View style={styles.table}>
            <View style={styles.tableRow}>
              <Text style={styles.tdSmall}>{ar ? 'التاريخ' : 'Date'}</Text>
              <Text style={styles.td}>{ar ? 'المعالج' : 'Therapist'}</Text>
              <Text style={styles.tdSmall}>{ar ? 'الحالة' : 'Status'}</Text>
              <Text style={styles.tdSmall}>{ar ? 'الدقائق' : 'Minutes'}</Text>
            </View>
            {appointments.slice(0, 50).map((a) => (
              <View key={a.id} style={styles.tableRow}>
                <Text style={styles.tdSmall}>{a.startsAt.toISOString().slice(0, 10)}</Text>
                <Text style={styles.td}>{ar ? a.therapistFullNameAr : a.therapistFullNameEn}</Text>
                <Text style={styles.tdSmall}>{a.status}</Text>
                <Text style={styles.tdSmall}>{a.durationMinutes}</Text>
              </View>
            ))}
            {appointments.length > 50 ? (
              <Text style={{ marginTop: 4, fontSize: 9, color: '#5A6580' }}>
                {ar
                  ? `… و ${appointments.length - 50} موعد إضافي`
                  : `… and ${appointments.length - 50} more`}
              </Text>
            ) : null}
          </View>
        </View>

        {redaction !== 'SELF' ? (
          <>
            <View style={styles.section}>
              <Text style={styles.h2}>
                {ar ? 'خطط العلاج' : 'Treatment plans'} ({plans.length})
              </Text>
              {plans.length === 0 ? (
                <Text>—</Text>
              ) : (
                <View style={styles.table}>
                  {plans.map((p) => (
                    <View key={p.id} style={styles.tableRow}>
                      <Text style={styles.tdSmall}>{p.createdAt.toISOString().slice(0, 10)}</Text>
                      <Text style={styles.td}>{p.diagnosisPrimary}</Text>
                      <Text style={styles.tdSmall}>{p.status}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.h2}>{ar ? 'الجلسات' : 'Session notes'}</Text>
              <Text>
                {ar ? `إجمالي ملاحظات الجلسات: ${noteCount}` : `Total session notes: ${noteCount}`}
              </Text>
            </View>
          </>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.h2}>
            {ar ? 'البرنامج المنزلي' : 'Home program'} ({homeProgram.length})
          </Text>
          {homeProgram.length === 0 ? (
            <Text>—</Text>
          ) : (
            homeProgram.map((h) => (
              <Text key={h.id}>• {ar ? h.exerciseNameAr : h.exerciseNameEn}</Text>
            ))
          )}
        </View>

        {redaction === 'ADMIN' ? (
          <View style={styles.section}>
            <Text style={styles.h2}>{ar ? 'سجل التدقيق' : 'Audit summary'}</Text>
            <Text>
              {ar
                ? `عدد الإجراءات على هذا الملف: ${auditCount}`
                : `Total audit actions on this profile: ${auditCount}`}
            </Text>
          </View>
        ) : null}

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `${ar ? 'سري' : 'Confidential'} · Theone.pt v1 · ${pageNumber}/${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}
