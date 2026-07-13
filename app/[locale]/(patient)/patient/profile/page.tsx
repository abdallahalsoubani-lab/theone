import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';

import { PatientSelfEditForm } from '@/components/patient-portal/PatientSelfEditForm';
import { ExportPatientFileButton } from '@/components/exports/ExportPatientFileButton';
import { getEffectiveSession } from '@/lib/impersonation/session';
import { getPatientFile } from '@/lib/patients/queries';

export default async function PatientProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Effective session so Act-As resolves to the impersonated patient
  // (QA Admin #16/#18). A minimal user without a PatientProfile row lands on
  // notFound() below — graceful, no crash.
  const session = await getEffectiveSession();
  if (!session?.user) redirect(`/${locale}/login`);
  if (session.user.role !== 'PATIENT') redirect(`/${locale}/`);
  const patient = await getPatientFile(session.user.id);
  if (!patient) notFound();
  const t = await getTranslations('patient.portal');

  return (
    <section className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-medium text-brand-navy">{t('profileTitle')}</h1>
          <p className="text-sm text-brand-textMuted">{t('profileSubtitle')}</p>
        </div>
        <ExportPatientFileButton patientId={session.user.id} locale={locale} />
      </header>
      <PatientSelfEditForm
        initial={{
          email: patient.email,
          address: patient.address ?? '',
          emergencyContactName: patient.emergencyContactName,
          emergencyContactPhone: patient.emergencyContactPhone,
          languagePref: patient.languagePref,
          hijriCalendarPref: patient.hijriCalendarPref,
        }}
        readOnly={{
          fullNameEn: patient.fullNameEn,
          fullNameAr: patient.fullNameAr,
          // Patient viewing their own profile always sees their phone.
          phone: patient.phone ?? '',
          dateOfBirth: patient.dateOfBirth,
          gender: patient.gender,
        }}
      />
    </section>
  );
}
