import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ExerciseForm } from '@/components/exercises/ExerciseForm';
import { requirePermission } from '@/lib/rbac/guards';

export default async function NewExercisePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('exercises.create');
  const t = await getTranslations('clinical.exercises');

  return (
    <section className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-medium text-brand-navy">{t('newExerciseTitle')}</h1>
        <p className="mt-1 text-sm text-brand-textMuted">{t('newExerciseSubtitle')}</p>
      </header>
      <ExerciseForm />
    </section>
  );
}
