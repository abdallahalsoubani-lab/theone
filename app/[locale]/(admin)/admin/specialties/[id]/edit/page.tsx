import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { getSpecialtyById } from '@/lib/admin/specialties/queries';
import { requirePermission } from '@/lib/rbac/guards';

import { SpecialtyForm } from '../../_components/SpecialtyForm';

export default async function EditSpecialtyPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission('users.update');
  const t = await getTranslations('admin.specialties');
  const specialty = await getSpecialtyById(id);
  if (!specialty) notFound();
  return (
    <section className="space-y-6 p-6">
      <h1 className="text-2xl font-medium text-brand-navy">{t('editSpecialty')}</h1>
      <SpecialtyForm
        mode="edit"
        initial={{
          id: specialty.id,
          nameEn: specialty.nameEn,
          nameAr: specialty.nameAr,
          description: specialty.description,
          active: specialty.active,
        }}
      />
    </section>
  );
}
