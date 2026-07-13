import { IntakeType } from '@prisma/client';
import { getTranslations } from 'next-intl/server';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { formatDateTime } from '@/lib/format/date';
import { formatIntakeAnswer } from '@/lib/intake/display';
import type { IntakeAssessmentDetail } from '@/lib/intake/queries';

/**
 * Read-only view of a completed intake assessment (Fix 6B item 4 — the
 * patient-file "View" link previously 404'd because no view route existed).
 * Mirrors the field-key + label pattern of the intake-submissions detail page.
 */
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

export async function IntakeAssessmentView({
  assessment,
  backHref,
  locale,
}: {
  assessment: IntakeAssessmentDetail;
  backHref: string;
  locale: 'en' | 'ar';
}) {
  const t = await getTranslations('intake');
  const tFields = await getTranslations(
    assessment.type === IntakeType.ADULT ? 'intake.adult' : 'intake.pediatric',
  );

  const isAdult = assessment.type === IntakeType.ADULT;
  const data = (isAdult ? assessment.adult : assessment.pediatric) ?? {};
  const fieldKeys = isAdult ? ADULT_FIELD_KEYS : PEDIATRIC_FIELD_KEYS;
  // Enum answers render through the SAME intake.adult option labels the form
  // inputs use (QA 5.1); unknown values fall back to the stored raw key.
  const rows = fieldKeys.map((k) => ({
    label: tFields(k),
    value: formatIntakeAnswer(k, data[k], tFields),
  }));
  const assessedBy = locale === 'ar' ? assessment.assessedByAr : assessment.assessedByEn;

  return (
    <section className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={backHref as `/${string}`} className="text-sm text-brand-cyan hover:underline">
          ← {t('backToFile')}
        </Link>
        <Badge variant={isAdult ? 'default' : 'outline'}>
          {isAdult ? t('typeAdult') : t('typePediatric')}
        </Badge>
        <Badge variant="muted">{t('readOnly')}</Badge>
        <span className="text-xs text-brand-textMuted">
          <bdi>{formatDateTime(assessment.assessedAt, locale)}</bdi>
          {assessedBy ? (
            <>
              {' · '}
              {t('assessedBy')} <bdi>{assessedBy}</bdi>
            </>
          ) : null}
        </span>
      </div>

      <Card>
        <CardContent className="space-y-3 p-6">
          <h2 className="text-lg font-medium text-brand-navy">
            {isAdult ? t('typeAdult') : t('typePediatric')}
          </h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {rows.map((r) => (
              <Row key={r.label} label={r.label} value={r.value} />
            ))}
          </dl>
        </CardContent>
      </Card>

      {assessment.custom.length > 0 ? (
        <Card>
          <CardContent className="space-y-3 p-6">
            <h2 className="text-lg font-medium text-brand-navy">{t('customAnswers')}</h2>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              {assessment.custom.map((c, i) => (
                <Row
                  key={i}
                  label={locale === 'ar' ? c.nameAr : c.nameEn}
                  value={locale === 'ar' ? c.valueAr : c.valueEn}
                />
              ))}
            </dl>
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-brand-textMuted">{label}</dt>
      <dd className="whitespace-pre-wrap text-sm text-brand-text">{value}</dd>
    </div>
  );
}
