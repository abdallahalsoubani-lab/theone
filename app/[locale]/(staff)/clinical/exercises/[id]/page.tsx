import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { getExerciseById } from '@/lib/exercises/queries';
import { labelForCategory, labelForRegion } from '@/lib/exercises/taxonomy';
import { requirePermission } from '@/lib/rbac/guards';

export default async function ExerciseDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission('exercises.read');
  const t = await getTranslations('clinical.exercises');

  const exercise = await getExerciseById(id);
  if (!exercise) notFound();

  const localeTag = locale === 'ar' ? 'ar' : 'en';
  const name = localeTag === 'ar' ? exercise.nameAr : exercise.nameEn;
  const description = localeTag === 'ar' ? exercise.descriptionAr : exercise.descriptionEn;
  const instruction =
    localeTag === 'ar' ? exercise.defaultInstructionAr : exercise.defaultInstructionEn;

  return (
    <section className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-medium text-brand-navy">{name}</h1>
            <span className="font-mono text-sm text-brand-textMuted">v{exercise.version}</span>
            {!exercise.active ? <Badge variant="destructive">{t('archived')}</Badge> : null}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge variant="muted">{labelForCategory(exercise.category, localeTag)}</Badge>
            <Badge variant="outline">{labelForRegion(exercise.anatomicalRegion, localeTag)}</Badge>
          </div>
        </div>
        {exercise.active ? (
          <Button asChild variant="outline">
            <Link href={`/clinical/exercises/${exercise.id}/edit`}>{t('edit')}</Link>
          </Button>
        ) : null}
      </header>

      {exercise.videoUrl ? (
        <video
          src={exercise.videoUrl}
          controls
          preload="metadata"
          className="w-full rounded-md border border-brand-border"
        >
          <track kind="captions" />
        </video>
      ) : exercise.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={exercise.imageUrl}
          alt=""
          className="w-full rounded-md border border-brand-border"
        />
      ) : null}

      <section>
        <h2 className="text-sm font-semibold text-brand-navy">{t('description')}</h2>
        <p className="mt-1 whitespace-pre-wrap text-sm text-brand-text">{description}</p>
      </section>

      {exercise.contraindications ? (
        <section className="rounded-md border border-amber-200 bg-amber-50 p-3">
          <h2 className="text-sm font-semibold text-amber-900">{t('contraindications')}</h2>
          <p className="mt-1 whitespace-pre-wrap text-sm text-amber-900">
            {exercise.contraindications}
          </p>
        </section>
      ) : null}

      {instruction ? (
        <section>
          <h2 className="text-sm font-semibold text-brand-navy">{t('defaultInstruction')}</h2>
          <p className="mt-1 whitespace-pre-wrap text-sm text-brand-text">{instruction}</p>
        </section>
      ) : null}
    </section>
  );
}
