import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { getRoomById } from '@/lib/admin/rooms/queries';
import { requirePermission } from '@/lib/rbac/guards';

import { RoomForm } from '../../_components/RoomForm';

export default async function EditRoomPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission('rooms.update');
  const t = await getTranslations('admin.rooms');
  const room = await getRoomById(id);
  if (!room) notFound();
  return (
    <section className="space-y-6 p-6">
      <h1 className="text-2xl font-medium text-brand-navy">{t('editRoom')}</h1>
      <RoomForm mode="edit" initial={{ id: room.id, name: room.name, active: room.active }} />
    </section>
  );
}
