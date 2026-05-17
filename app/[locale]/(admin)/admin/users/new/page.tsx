import { getTranslations, setRequestLocale } from 'next-intl/server';

import { db } from '@/lib/db';
import { requirePermission } from '@/lib/rbac/guards';

import { UserForm } from '../_components/UserForm';

export default async function NewUserPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('users.create');
  const t = await getTranslations('admin.users');
  const specialties = await db.specialty.findMany({
    where: { active: true },
    select: { id: true, nameEn: true, nameAr: true },
    orderBy: { nameEn: 'asc' },
  });

  return (
    <section className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-medium text-brand-navy">{t('newUser')}</h1>
      </header>
      <UserForm mode="create" specialties={specialties} />
    </section>
  );
}
