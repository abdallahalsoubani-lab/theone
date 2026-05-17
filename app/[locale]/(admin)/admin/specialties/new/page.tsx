import { getTranslations, setRequestLocale } from 'next-intl/server';

import { requirePermission } from '@/lib/rbac/guards';

import { SpecialtyForm } from '../_components/SpecialtyForm';

export default async function NewSpecialtyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('users.update');
  const t = await getTranslations('admin.specialties');
  return (
    <section className="space-y-6 p-6">
      <h1 className="text-2xl font-medium text-brand-navy">{t('newSpecialty')}</h1>
      <SpecialtyForm mode="create" />
    </section>
  );
}
