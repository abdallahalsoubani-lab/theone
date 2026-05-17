import { getTranslations, setRequestLocale } from 'next-intl/server';

import { requirePermission } from '@/lib/rbac/guards';

import { RoomForm } from '../_components/RoomForm';

export default async function NewRoomPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('rooms.create');
  const t = await getTranslations('admin.rooms');
  return (
    <section className="space-y-6 p-6">
      <h1 className="text-2xl font-medium text-brand-navy">{t('newRoom')}</h1>
      <RoomForm mode="create" />
    </section>
  );
}
