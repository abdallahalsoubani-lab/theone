import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { ExerciseForm } from '@/components/exercises/ExerciseForm';
import { getExerciseById } from '@/lib/exercises/queries';
import { requirePermission } from '@/lib/rbac/guards';

export default async function EditExercisePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission('exercises.update');
  const t = await getTranslations('clinical.exercises');

  const exercise = await getExerciseById(id);
  if (!exercise || exercise.replacedById) notFound();

  return (
    <section className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-medium text-brand-navy">{t('editTitle')}</h1>
        <p className="mt-1 text-sm text-brand-textMuted">{t('editSubtitle')}</p>
      </header>
      <ExerciseForm initial={exercise} />
    </section>
  );
}
