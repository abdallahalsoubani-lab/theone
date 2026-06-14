import { CustomQuestionAppliesTo, IntakeType } from '@prisma/client';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { SubmissionReviewActions } from '@/components/intake-submissions/SubmissionReviewActions';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { listCustomQuestions } from '@/lib/admin/custom-questions/queries';
import { formatDateTime } from '@/lib/format/date';
import { findPatientByPhone, getSubmissionById } from '@/lib/intake-submissions/queries';
import { requirePermission } from '@/lib/rbac/guards';

const ADULT_FIELD_KEYS = [
  'physicalActivityLevel',
  'medicalDiagnosis',
  'primaryComplaint',
  'painTiming',
  'symptomDuration',
  'painSeverity',
  'painAggravatingFactors',
  'painRelievingFactors',
  'painStability',
  'currentMedicationsForProblem',
  'otherMedications',
  'conditions',
  'otherConditions',
  'previousFractures',
  'previousSurgeries',
  'previousPtExperience',
  'referralSource',
] as const;

const PEDIATRIC_FIELD_KEYS = ['numberOfSiblings', 'birthOrder'] as const;

function formatValue(v: unknown): string {
  if (Array.isArray(v)) return v.length ? v.map(String).join(', ') : '—';
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}

export default async function IntakeSubmissionDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission('intake_submission.read');
  const intlLocale: 'en' | 'ar' = locale === 'ar' ? 'ar' : 'en';

  const submission = await getSubmissionById(id);
  if (!submission) notFound();

  const [t, tProfile, tFields, customQuestions, duplicate] = await Promise.all([
    getTranslations('intakeSubmissions'),
    getTranslations('publicIntake'),
    getTranslations(submission.type === IntakeType.ADULT ? 'intake.adult' : 'intake.pediatric'),
    listCustomQuestions({
      scope:
        submission.type === IntakeType.ADULT
          ? CustomQuestionAppliesTo.ADULT
          : CustomQuestionAppliesTo.PEDIATRIC,
    }),
    findPatientByPhone(submission.submittedPhone),
  ]);

  const profile = submission.profile;
  const answers = submission.answers;
  const customAnswers = (answers.customAnswers ?? {}) as Record<string, unknown>;
  const questionById = new Map(customQuestions.map((q) => [q.id, q]));

  const fieldKeys = submission.type === IntakeType.ADULT ? ADULT_FIELD_KEYS : PEDIATRIC_FIELD_KEYS;
  const answerRows = fieldKeys.map((k) => ({
    label: tFields(k),
    value: formatValue(answers[k]),
  }));
  const customRows = Object.entries(customAnswers).map(([qid, value]) => {
    const q = questionById.get(qid);
    return {
      label: q ? (intlLocale === 'ar' ? q.nameAr : q.nameEn) : qid,
      value: formatValue(value),
    };
  });

  const profileRows: Array<{ label: string; value: string }> = [
    { label: tProfile('fullName'), value: formatValue(profile.fullName) },
    { label: tProfile('phone'), value: submission.submittedPhone },
    { label: tProfile('dateOfBirth'), value: formatValue(profile.dateOfBirth) },
    { label: tProfile('gender'), value: formatValue(profile.gender) },
    { label: tProfile('address'), value: formatValue(profile.address) },
    { label: tProfile('emailOptional'), value: formatValue(profile.email) },
  ];

  const handled = submission.status !== 'PENDING';

  return (
    <section className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Badge variant={submission.type === IntakeType.ADULT ? 'default' : 'outline'}>
          {submission.type === IntakeType.ADULT ? t('typeAdult') : t('typeChild')}
        </Badge>
        <h1 className="text-xl font-semibold text-brand-navy">{submission.submittedName}</h1>
        <span className="text-xs text-brand-textMuted">
          {formatDateTime(submission.createdAt, intlLocale)}
        </span>
      </div>

      {handled ? (
        <p className="rounded-md border border-brand-border bg-brand-bg p-4 text-sm text-brand-textMuted">
          {t(submission.status === 'APPROVED' ? 'alreadyApproved' : 'alreadyRejected')}
        </p>
      ) : (
        <SubmissionReviewActions
          submissionId={submission.id}
          locale={intlLocale}
          duplicate={
            duplicate
              ? {
                  patientId: duplicate.id,
                  name: intlLocale === 'ar' ? duplicate.fullNameAr : duplicate.fullNameEn,
                  phone: duplicate.phone,
                }
              : null
          }
        />
      )}

      <Card>
        <CardContent className="space-y-3 p-6">
          <h2 className="text-lg font-medium text-brand-navy">{t('submittedDetails')}</h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {profileRows.map((r) => (
              <Row key={r.label} label={r.label} value={r.value} />
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-6">
          <h2 className="text-lg font-medium text-brand-navy">{t('answers')}</h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {answerRows.map((r) => (
              <Row key={r.label} label={r.label} value={r.value} />
            ))}
            {customRows.map((r, i) => (
              <Row key={`c-${i}`} label={r.label} value={r.value} />
            ))}
          </dl>
        </CardContent>
      </Card>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wider text-brand-textMuted">{label}</dt>
      <dd className="text-sm text-brand-text">{value}</dd>
    </div>
  );
}
