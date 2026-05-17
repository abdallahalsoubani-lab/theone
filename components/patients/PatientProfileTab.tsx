import { Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { formatDate } from '@/lib/format/date';
import { formatPhone } from '@/lib/format/phone';
import type { PatientFileData } from '@/lib/patients/queries';

interface Props {
  patient: PatientFileData;
  locale: 'en' | 'ar';
  /** Secretary/Admin only — clinical roles see the read view without the button. */
  canEdit: boolean;
  /** Secretary/Admin only — force a new temp password via WhatsApp. */
  canResetPassword: boolean;
  basePath: string;
  resetTrigger?: ReactNode;
}

export function PatientProfileTab({
  patient,
  locale,
  canEdit,
  canResetPassword,
  basePath,
  resetTrigger,
}: Props) {
  const t = useTranslations('patients.form');
  const tFile = useTranslations('patients.file');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        {canResetPassword ? resetTrigger : null}
        {canEdit ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`${basePath}/${patient.id}/edit`}>
              <Pencil className="me-2 size-4" />
              {tFile('tabProfile')}
            </Link>
          </Button>
        ) : null}
      </div>

      <Card>
        <CardContent className="grid gap-4 p-6 sm:grid-cols-2">
          <Field label={t('fullNameEn')} value={patient.fullNameEn} />
          <Field label={t('fullNameAr')} value={patient.fullNameAr} />
          <Field label={t('dateOfBirth')} value={formatDate(patient.dateOfBirth, locale)} />
          <Field label={t('gender')} value={patient.gender} />
          <Field label={t('nationalId')} value={patient.nationalId} />
          <Field label={t('languagePref')} value={patient.languagePref} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-4 p-6 sm:grid-cols-2">
          <Field label={t('phone')} value={formatPhone(patient.phone)} />
          <Field label={t('email')} value={patient.email} />
          <Field label={t('address')} value={patient.address} className="sm:col-span-2" />
          <Field label={t('occupation')} value={patient.occupation} />
          <Field label={t('emergencyContactName')} value={patient.emergencyContactName} />
          <Field
            label={t('emergencyContactPhone')}
            value={
              patient.emergencyContactPhone ? formatPhone(patient.emergencyContactPhone) : null
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-6">
          <Field
            label={t('medicalHistorySummary')}
            value={patient.medicalHistorySummary}
            multiline
          />
          <Field label={t('allergies')} value={patient.allergies} multiline />
          <Field label={t('currentMedications')} value={patient.currentMedications} multiline />
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  value,
  multiline,
  className,
}: {
  label: string;
  value: string | null;
  multiline?: boolean;
  className?: string;
}) {
  return (
    <div className={`space-y-1 ${className ?? ''}`}>
      <p className="text-xs font-medium uppercase tracking-wider text-brand-textMuted">{label}</p>
      <p className={`text-sm text-brand-text ${multiline ? 'whitespace-pre-wrap' : ''}`}>
        {value ?? '—'}
      </p>
    </div>
  );
}
