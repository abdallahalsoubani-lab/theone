import { Document, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer';
import { AuditAction } from '@prisma/client';

import { withAudit } from '@/lib/audit/withAudit';
import { db, toLocalizedError, type LocalizedError } from '@/lib/db';
import { PedAssessmentError, PED_ERRORS } from '@/lib/pediatric-assessment/errors';
import { CORE_FIELDS, CORE_SECTIONS } from '@/lib/pediatric-assessment/coreFields';
import {
  listFieldsForAssessment,
  type CustomFieldRow,
} from '@/lib/pediatric-assessment/customFields/queries';
import { getAssessmentById } from '@/lib/pediatric-assessment/queries';

export function pedExportErrorToLocalized(err: unknown): LocalizedError {
  if (err instanceof PedAssessmentError) return err.error;
  return toLocalizedError(err);
}

interface Args {
  assessmentId: string;
  locale: 'en' | 'ar';
}

interface Row {
  label: string;
  value: string;
}
interface Sec {
  heading: string;
  rows: Row[];
}

const styles = StyleSheet.create({
  page: { padding: 36, fontFamily: 'Helvetica', fontSize: 10, color: '#212940' },
  header: {
    marginBottom: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#D8DEE8',
  },
  clinicName: { fontSize: 16, fontWeight: 700, color: '#212940' },
  meta: { fontSize: 9, color: '#5A6580', marginTop: 4 },
  section: { marginTop: 12 },
  h2: { fontSize: 12, fontWeight: 700, color: '#0EA5B7', marginBottom: 4 },
  row: { flexDirection: 'row', marginBottom: 2 },
  rowLabel: { width: 150, color: '#5A6580' },
  rowValue: { flex: 1 },
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

function Pdf({
  ar,
  title,
  meta,
  sections,
}: {
  ar: boolean;
  title: string;
  meta: string;
  sections: Sec[];
}) {
  return (
    <Document title={title}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.clinicName}>
            {ar ? 'المركز الأول للعلاج الطبيعي' : 'The One for Physiotherapy'}
          </Text>
          <Text style={styles.meta}>{title}</Text>
          <Text style={styles.meta}>{meta}</Text>
        </View>
        {sections.map((s, i) => (
          <View key={i} style={styles.section} wrap={false}>
            <Text style={styles.h2}>{s.heading}</Text>
            {s.rows.map((r, j) => (
              <View key={j} style={styles.row}>
                <Text style={styles.rowLabel}>{r.label}</Text>
                <Text style={styles.rowValue}>{r.value}</Text>
              </View>
            ))}
          </View>
        ))}
        <Text style={styles.footer} fixed>
          {ar
            ? 'وثيقة سريرية — للاستخدام داخل العيادة فقط.'
            : 'Clinical document — for in-clinic use only.'}
        </Text>
      </Page>
    </Document>
  );
}

function customValueToEnglish(cf: CustomFieldRow, value: unknown): string {
  const labelFor = (v: string) => cf.options.find((o) => o.value === v)?.labelEn ?? v;
  if (cf.type === 'MULTI_SELECT' && Array.isArray(value))
    return value.map((v) => labelFor(String(v))).join(', ');
  if (cf.type === 'SINGLE_SELECT' && typeof value === 'string') return labelFor(value);
  if (cf.type === 'BOOLEAN') return value === true ? 'Yes' : value === false ? 'No' : '—';
  if (Array.isArray(value)) return value.join(', ');
  if (value === undefined || value === null || value === '') return '—';
  return String(value);
}

function coreValue(value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  if (value === undefined || value === null || value === '') return '—';
  return String(value);
}

function ageString(dob: Date, now: Date): string {
  let months = (now.getFullYear() - dob.getFullYear()) * 12 + (now.getMonth() - dob.getMonth());
  if (now.getDate() < dob.getDate()) months -= 1;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return `${y}y ${m}m`;
}

const generateInner = async ({
  assessmentId,
  locale,
}: Args): Promise<{ buffer: Buffer; patientId: string }> => {
  const ar = locale === 'ar';
  const assessment = await getAssessmentById(assessmentId);
  if (!assessment) throw new PedAssessmentError(PED_ERRORS.NOT_FOUND);

  const patient = await db.user.findUnique({
    where: { id: assessment.patientId },
    select: {
      fullNameEn: true,
      fullNameAr: true,
      patientProfile: { select: { dateOfBirth: true } },
    },
  });
  const patientName = patient
    ? ar
      ? patient.fullNameAr
      : patient.fullNameEn
    : assessment.patientId;
  const dob = patient?.patientProfile?.dateOfBirth ?? null;

  const core = assessment.coreData;
  const fields = await listFieldsForAssessment(assessment.customData);

  // Core sections in §4 order.
  const sections: Sec[] = CORE_SECTIONS.map((s) => ({
    heading: ar ? s.labelAr : s.labelEn,
    rows: CORE_FIELDS.filter((f) => f.section === s.id && f.type !== 'READONLY').map((f) => ({
      label: ar ? f.labelAr : f.labelEn,
      value: coreValue(core[f.key]),
    })),
  }));

  if (fields.length > 0) {
    sections.push({
      heading: ar ? 'حقول مخصصة' : 'Custom fields',
      rows: fields.map((cf) => ({
        label: ar ? cf.labelAr : cf.labelEn,
        value: customValueToEnglish(cf, assessment.customData[cf.id]),
      })),
    });
  }

  const assessor = ar ? assessment.createdByNameAr : assessment.createdByNameEn;
  const dateStr =
    typeof core.date === 'string' ? core.date : assessment.createdAt.toISOString().slice(0, 10);
  const dobLine = dob
    ? `${ar ? 'تاريخ الميلاد' : 'DOB'}: ${dob.toISOString().slice(0, 10)} (${ageString(dob, new Date())})`
    : '';
  const meta = [
    `${ar ? 'المراجع' : 'Patient'}: ${patientName}`,
    dobLine,
    `${ar ? 'تاريخ التقييم' : 'Assessment date'}: ${dateStr}`,
    `${ar ? 'المقيّم' : 'Assessor'}: ${assessor}`,
  ]
    .filter(Boolean)
    .join('  ·  ');

  const title = ar ? 'التقييم العلاجي' : 'Clinical assessment';

  const stream = await pdf(
    <Pdf ar={ar} title={title} meta={meta} sections={sections} />,
  ).toBuffer();
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    (stream as unknown as NodeJS.ReadableStream).on('data', (c: Buffer) => chunks.push(c));
    (stream as unknown as NodeJS.ReadableStream).on('end', () => resolve());
    (stream as unknown as NodeJS.ReadableStream).on('error', reject);
  });
  return { buffer: Buffer.concat(chunks), patientId: assessment.patientId };
};

export const generatePediatricAssessmentPdf = withAudit<
  [Args],
  { buffer: Buffer; patientId: string }
>(
  {
    entityType: 'PediatricAssessment',
    action: AuditAction.READ_SENSITIVE,
    extractEntityId: (_args, result) => result.patientId,
    extractAfter: () => ({ event: 'PEDIATRIC_ASSESSMENT_EXPORTED' }),
  },
  generateInner,
);
