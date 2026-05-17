import { getTranslations, setRequestLocale } from 'next-intl/server';

import { auth } from '@/auth';
import { PatientsTable } from '@/components/patients/PatientsTable';
import { Badge } from '@/components/ui/badge';
import { listPatients } from '@/lib/patients/queries';
import { patientListFiltersSchema } from '@/lib/patients/schemas';
import { requirePermission } from '@/lib/rbac/guards';

export default async function TherapistPatientsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('patients.read.assigned');
  const t = await getTranslations('patients.list');
  const session = await auth();
  const sp = await searchParams;

  const filters = patientListFiltersSchema.parse({
    search: sp.q,
    intakeStatus: (sp.intake as 'all' | 'pending' | 'completed' | 'multiple') ?? 'all',
    assignment: (sp.assignment as 'all' | 'assigned' | 'unassigned') ?? 'all',
    ageGroup: (sp.age as 'all' | 'adult' | 'pediatric') ?? 'all',
    page: sp.page ? Number(sp.page) : 1,
    pageSize: 20,
  });
  const { rows, total } = await listPatients({
    scope: { kind: 'assigned', clinicianId: session!.user.id },
    filters,
  });

  return (
    <section className="space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-medium text-brand-navy">{t('title')}</h1>
          <Badge variant="muted">{total}</Badge>
        </div>
      </header>
      <PatientsTable
        rows={rows}
        total={total}
        page={filters.page}
        pageSize={filters.pageSize}
        initialSearch={filters.search ?? ''}
        basePath="/therapist/patients"
        canCreate={false}
        canEdit={false}
      />
    </section>
  );
}
