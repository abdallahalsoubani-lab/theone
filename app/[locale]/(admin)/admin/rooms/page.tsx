import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { listRooms } from '@/lib/admin/rooms/queries';
import { roomListFiltersSchema } from '@/lib/admin/rooms/schemas';
import { requirePermission } from '@/lib/rbac/guards';

import { RoomsTable } from './_components/RoomsTable';

export default async function AdminRoomsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('rooms.read');
  const t = await getTranslations('admin.rooms');
  const sp = await searchParams;

  const filters = roomListFiltersSchema.parse({
    search: sp.q,
    status: (sp.status as 'active' | 'inactive' | 'all') ?? 'all',
    page: sp.page ? Number(sp.page) : 1,
    pageSize: 20,
  });
  const { rows, total } = await listRooms(filters);

  return (
    <section className="space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-medium text-brand-navy">{t('title')}</h1>
          <Badge variant="muted">{total}</Badge>
        </div>
        <Button asChild>
          <Link href="/admin/rooms/new">{t('newRoom')}</Link>
        </Button>
      </header>
      <RoomsTable
        rows={rows}
        total={total}
        page={filters.page}
        pageSize={filters.pageSize}
        initialSearch={filters.search ?? ''}
      />
    </section>
  );
}
