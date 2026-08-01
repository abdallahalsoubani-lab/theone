import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { PatientCreatedView } from '@/components/patients/PatientCreatedView';
import { getPatientById } from '@/lib/patients/queries';
import { requirePermission } from '@/lib/rbac/guards';

/**
 * Single-use success screen after createPatientAction — admin shell (Aug 1).
 * The temp password rides the query string so it can be copied once and
 * never persisted; a refresh loses it by design.
 */
export default async function AdminPatientCreatedPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ p?: string; w?: string }>;
}) {
  const { locale, id } = await params;
  const { p: tempPassword, w: whatsappStatus } = await searchParams;
  setRequestLocale(locale);
  await requirePermission('patients.read');
  const patient = await getPatientById(id);
  if (!patient) notFound();
  const t = await getTranslations('patients.created');
  return (
    <PatientCreatedView
      patientId={id}
      basePath="/admin/patients"
      name={locale === 'ar' ? patient.fullNameAr : patient.fullNameEn}
      tempPassword={tempPassword ?? null}
      whatsappOk={whatsappStatus !== 'FAILED'}
      title={t('title')}
      subtitle={t('subtitle', {
        name: locale === 'ar' ? patient.fullNameAr : patient.fullNameEn,
      })}
      tempPasswordHeading={t('tempPasswordHeading')}
      tempPasswordHint={t('tempPasswordHint')}
      copyLabel={t('copyPassword')}
      copiedLabel={t('copied')}
      whatsappOkLabel={t('whatsappOk')}
      whatsappFailedLabel={t('whatsappFailed')}
      ctaIntakeLabel={t('ctaIntake')}
      ctaListLabel={t('ctaList')}
    />
  );
}
