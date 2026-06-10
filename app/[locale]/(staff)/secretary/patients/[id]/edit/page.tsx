import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { PatientCareTeamCard } from '@/components/patients/PatientCareTeamCard';
import { PatientForm } from '@/components/patients/PatientForm';
import { listActiveClinicians } from '@/lib/appointments/queries';
import { getPatientFile } from '@/lib/patients/queries';
import { requirePermission } from '@/lib/rbac/guards';

export default async function SecretaryPatientEditPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission('patients.update');
  const patient = await getPatientFile(id);
  if (!patient) notFound();
  const t = await getTranslations('patients.form');
  const clinicians = await listActiveClinicians();
  const therapistOptions = clinicians
    .filter((c) => c.role === 'THERAPIST')
    .map((c) => ({ id: c.id, fullNameEn: c.fullNameEn, fullNameAr: c.fullNameAr }));
  const doctorOptions = clinicians
    .filter((c) => c.role === 'DOCTOR')
    .map((c) => ({ id: c.id, fullNameEn: c.fullNameEn, fullNameAr: c.fullNameAr }));
  return (
    <section className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="text-2xl font-medium text-brand-navy">{t('editTitle')}</h1>
      <PatientCareTeamCard
        patientId={patient.id}
        initialTherapists={patient.careTeam.therapists}
        initialDoctors={patient.careTeam.doctors}
        therapistOptions={therapistOptions}
        doctorOptions={doctorOptions}
      />
      <PatientForm
        mode="edit"
        initial={{
          id: patient.id,
          fullNameEn: patient.fullNameEn,
          fullNameAr: patient.fullNameAr,
          phone: patient.phone,
          email: patient.email,
          dateOfBirth: patient.dateOfBirth,
          gender: patient.gender,
          nationalId: patient.nationalId,
          address: patient.address ?? '',
          occupation: patient.occupation,
          emergencyContactName: patient.emergencyContactName,
          emergencyContactPhone: patient.emergencyContactPhone,
          languagePref: patient.languagePref,
          hijriCalendarPref: patient.hijriCalendarPref,
          medicalHistorySummary: patient.medicalHistorySummary,
          allergies: patient.allergies,
          currentMedications: patient.currentMedications,
        }}
      />
    </section>
  );
}
