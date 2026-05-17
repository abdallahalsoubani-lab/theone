import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { listUsers } from '@/lib/admin/users/queries';
import { userListFiltersSchema } from '@/lib/admin/users/schemas';
import { requirePermission } from '@/lib/rbac/guards';

import { UsersTable } from './_components/UsersTable';

export default async function AdminUsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('users.read');
  const t = await getTranslations('admin.users');
  const sp = await searchParams;

  const filters = userListFiltersSchema.parse({
    search: sp.q,
    status: (sp.status as 'active' | 'archived' | 'all') ?? 'active',
    page: sp.page ? Number(sp.page) : 1,
    pageSize: 20,
  });
  const { rows, total } = await listUsers(filters);

  return (
    <section className="space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-medium text-brand-navy">{t('title')}</h1>
          <Badge variant="muted">{total}</Badge>
        </div>
        <Button asChild>
          <Link href="/admin/users/new">{t('newUser')}</Link>
        </Button>
      </header>

      <UsersTable
        rows={rows}
        total={total}
        page={filters.page}
        pageSize={filters.pageSize}
        initialSearch={filters.search ?? ''}
      />
    </section>
  );
}
