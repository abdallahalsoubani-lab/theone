import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/auth';
import { PatientSelfEditForm } from '@/components/patient-portal/PatientSelfEditForm';
import { getPatientFile } from '@/lib/patients/queries';

export default async function PatientProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login`);
  if (session.user.role !== 'PATIENT') redirect(`/${locale}/`);
  const patient = await getPatientFile(session.user.id);
  if (!patient) notFound();
  const t = await getTranslations('patient.portal');

  return (
    <section className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-medium text-brand-navy">{t('profileTitle')}</h1>
        <p className="text-sm text-brand-textMuted">{t('profileSubtitle')}</p>
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
          phone: patient.phone,
          dateOfBirth: patient.dateOfBirth,
          gender: patient.gender,
        }}
      />
    </section>
  );
}
