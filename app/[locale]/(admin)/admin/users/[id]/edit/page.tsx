import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { db } from '@/lib/db';
import { getUserById } from '@/lib/admin/users/queries';
import { requirePermission } from '@/lib/rbac/guards';

import { UserForm } from '../../_components/UserForm';

export default async function EditUserPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission('users.update');
  const t = await getTranslations('admin.users');

  const [user, specialties] = await Promise.all([
    getUserById(id),
    db.specialty.findMany({
      where: { active: true },
      select: { id: true, nameEn: true, nameAr: true },
      orderBy: { nameEn: 'asc' },
    }),
  ]);
  if (!user) notFound();

  return (
    <section className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-medium text-brand-navy">{t('editUser')}</h1>
      </header>
      <UserForm
        mode="edit"
        specialties={specialties}
        initial={{
          id: user.id,
          fullNameEn: user.fullNameEn,
          fullNameAr: user.fullNameAr,
          email: user.email ?? '',
          phone: user.phone,
          role: user.role,
          languagePref: user.languagePref,
          specialtyIds: user.specialties.map((s) => s.specialtyId),
          mustChangePassword: user.mustChangePassword,
        }}
      />
    </section>
  );
}
