import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { listSpecialties } from '@/lib/admin/specialties/queries';
import { specialtyListFiltersSchema } from '@/lib/admin/specialties/schemas';
import { requirePermission } from '@/lib/rbac/guards';

import { SpecialtiesTable } from './_components/SpecialtiesTable';

export default async function AdminSpecialtiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('users.read');
  const t = await getTranslations('admin.specialties');
  const sp = await searchParams;

  const filters = specialtyListFiltersSchema.parse({
    search: sp.q,
    status: (sp.status as 'active' | 'inactive' | 'all') ?? 'all',
    page: sp.page ? Number(sp.page) : 1,
    pageSize: 20,
  });
  const { rows, total } = await listSpecialties(filters);

  return (
    <section className="space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-medium text-brand-navy">{t('title')}</h1>
          <Badge variant="muted">{total}</Badge>
        </div>
        <Button asChild>
          <Link href="/admin/specialties/new">{t('newSpecialty')}</Link>
        </Button>
      </header>
      <SpecialtiesTable
        rows={rows}
        total={total}
        page={filters.page}
        pageSize={filters.pageSize}
        initialSearch={filters.search ?? ''}
      />
    </section>
  );
}
