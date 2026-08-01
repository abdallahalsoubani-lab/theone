import { getTranslations, setRequestLocale } from 'next-intl/server';

import { PatientsTable } from '@/components/patients/PatientsTable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { listPatients } from '@/lib/patients/queries';
import { patientListFiltersSchema } from '@/lib/patients/schemas';
import { can } from '@/lib/rbac/can';
import { requirePermission } from '@/lib/rbac/guards';

/**
 * Admin patients list (Aug 1 owner request). The Admin has held
 * patients.create/update since Prompt 6, but their shell only had the A-19
 * read-only file page — add/edit lived exclusively in the Secretary flows.
 * Same shared table as the Secretary list, admin basePath so every link
 * (open / edit / new / add-intake) stays inside the admin interface.
 */
export default async function AdminPatientsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission('patients.read');
  const t = await getTranslations('patients.list');
  const tExport = await getTranslations('patients.export');
  const sp = await searchParams;
  const canExport = can(viewer, 'patients.export');

  const filters = patientListFiltersSchema.parse({
    search: sp.q,
    intakeStatus: (sp.intake as 'all' | 'pending' | 'completed' | 'multiple') ?? 'all',
    assignment: (sp.assignment as 'all' | 'assigned' | 'unassigned') ?? 'all',
    ageGroup: (sp.age as 'all' | 'adult' | 'pediatric') ?? 'all',
    page: sp.page ? Number(sp.page) : 1,
    pageSize: 20,
  });
  const { rows, total } = await listPatients({ scope: { kind: 'all' }, filters });

  return (
    <section className="space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-medium text-brand-navy">{t('title')}</h1>
          <Badge variant="muted">{total}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canExport ? (
            <Button asChild variant="outline">
              <a href={`/api/v1/exports/patients?locale=${locale}`}>{tExport('button')}</a>
            </Button>
          ) : null}
          <Button asChild>
            <Link href="/admin/patients/new">{t('newPatient')}</Link>
          </Button>
        </div>
      </header>
      <PatientsTable
        rows={rows}
        total={total}
        page={filters.page}
        pageSize={filters.pageSize}
        initialSearch={filters.search ?? ''}
        basePath="/admin/patients"
        canCreate
        canEdit
        showFirstVisitBadge
      />
    </section>
  );
}
