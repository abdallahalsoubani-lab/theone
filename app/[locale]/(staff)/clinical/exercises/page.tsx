import { Plus } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { auth } from '@/auth';
import { ExercisesTable } from '@/components/exercises/ExercisesTable';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { listExercises } from '@/lib/exercises/queries';
import { requirePermission } from '@/lib/rbac/guards';

const PAGE_SIZE = 24;

export default async function ExerciseLibraryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('exercises.read');
  const t = await getTranslations('clinical.exercises');
  const sp = await searchParams;
  const session = await auth();

  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const showArchived = sp.archived === '1';

  const { rows, total } = await listExercises({
    search: sp.q,
    category: sp.cat,
    anatomicalRegion: sp.reg,
    showArchived,
    page,
    pageSize: PAGE_SIZE,
  });

  return (
    <section className="space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-medium text-brand-navy">{t('libraryTitle')}</h1>
          <p className="mt-1 text-sm text-brand-textMuted">{t('librarySubtitle')}</p>
        </div>
        <Button asChild>
          <Link href="/clinical/exercises/new">
            <Plus className="me-1 size-4" />
            {t('newExercise')}
          </Link>
        </Button>
      </header>
      <ExercisesTable
        rows={rows}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        showArchived={showArchived}
        canArchive={session?.user?.role === 'ADMIN'}
      />
    </section>
  );
}
