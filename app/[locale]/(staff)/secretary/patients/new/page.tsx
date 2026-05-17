import { getTranslations, setRequestLocale } from 'next-intl/server';

import { PatientForm } from '@/components/patients/PatientForm';
import { requirePermission } from '@/lib/rbac/guards';

export default async function NewPatientPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('patients.create');
  const t = await getTranslations('patients.form');
  return (
    <section className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="text-2xl font-medium text-brand-navy">{t('newTitle')}</h1>
      <PatientForm mode="create" />
    </section>
  );
}
