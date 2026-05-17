import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { getPatientById } from '@/lib/patients/queries';
import { requirePermission } from '@/lib/rbac/guards';

import { PatientCreatedView } from './_components/PatientCreatedView';

/**
 * Single-use success screen after createPatientAction.
 *
 * The temp password is passed via query string so it can be copied once and
 * never persisted in storage. After a refresh, the param is gone and the
 * password slot reads "shown once — already copied".
 */
export default async function PatientCreatedPage({
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
