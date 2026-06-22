'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { MediaUploader } from '@/components/exercises/MediaUploader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
// Locale-aware router: push('/clinical/exercises/<id>') resolves to
// /<locale>/clinical/... Using next/navigation's router pushed a non-prefixed
// path that didn't navigate (the "stuck on details, must refresh" bug).
import { useRouter } from '@/i18n/navigation';
import { createExerciseAction, updateExerciseAction } from '@/lib/exercises/actions';
import type { ExerciseRow } from '@/lib/exercises/queries';
import { ANATOMICAL_REGIONS, EXERCISE_CATEGORIES } from '@/lib/exercises/taxonomy';

interface Props {
  /** Omitted in create mode; passed in edit mode. */
  initial?: ExerciseRow;
}

/**
 * Shared create/edit form for exercises. Edit mode invokes
 * updateExerciseAction which creates a NEW versioned row server-side —
 * the existing row gets `replacedById` set so it stops appearing in
 * the active library list but stays referenced by historical
 * HomeProgramItems.
 */
export function ExerciseForm({ initial }: Props) {
  const t = useTranslations('clinical.exercises');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [nameEn, setNameEn] = useState(initial?.nameEn ?? '');
  const [nameAr, setNameAr] = useState(initial?.nameAr ?? '');
  const [category, setCategory] = useState(initial?.category ?? EXERCISE_CATEGORIES[0]!.value);
  const [region, setRegion] = useState(initial?.anatomicalRegion ?? ANATOMICAL_REGIONS[0]!.value);
  const [descriptionEn, setDescriptionEn] = useState(initial?.descriptionEn ?? '');
  const [descriptionAr, setDescriptionAr] = useState(initial?.descriptionAr ?? '');
  const [contraindications, setContraindications] = useState(initial?.contraindications ?? '');
  const [defaultInstructionEn, setDefaultInstructionEn] = useState(
    initial?.defaultInstructionEn ?? '',
  );
  const [defaultInstructionAr, setDefaultInstructionAr] = useState(
    initial?.defaultInstructionAr ?? '',
  );
  const [imageUrl, setImageUrl] = useState<string | null>(initial?.imageUrl ?? null);
  const [imageMimeType, setImageMimeType] = useState<string | null>(null);
  const [imageSizeBytes, setImageSizeBytes] = useState<number | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(initial?.videoUrl ?? null);
  const [videoMimeType, setVideoMimeType] = useState<string | null>(null);
  const [videoSizeBytes, setVideoSizeBytes] = useState<number | null>(null);

  function submit() {
    startTransition(async () => {
      const payload = {
        nameEn,
        nameAr,
        category,
        anatomicalRegion: region,
        descriptionEn,
        descriptionAr,
        contraindications: contraindications || null,
        defaultInstructionEn: defaultInstructionEn || null,
        defaultInstructionAr: defaultInstructionAr || null,
        imageUrl,
        imageMimeType,
        imageSizeBytes,
        videoUrl,
        videoMimeType,
        videoSizeBytes,
      };
      const r = initial
        ? await updateExerciseAction({ id: initial.id, ...payload })
        : await createExerciseAction(payload);
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(t(initial ? 'updatedToast' : 'createdToast'));
      // After CREATE, return to the library list — a guaranteed-usable landing
      // state (QA retest #2). After EDIT, go to the (existing) detail page.
      router.push(initial ? `/clinical/exercises/${r.data.exerciseId}` : '/clinical/exercises');
      router.refresh();
    });
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <section className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="nameEn">{t('nameEn')}</Label>
          <Input
            id="nameEn"
            value={nameEn}
            onChange={(e) => setNameEn(e.target.value)}
            required
            minLength={3}
          />
        </div>
        <div>
          <Label htmlFor="nameAr">{t('nameAr')}</Label>
          <Input
            id="nameAr"
            value={nameAr}
            onChange={(e) => setNameAr(e.target.value)}
            required
            minLength={3}
          />
        </div>
        <div>
          <Label htmlFor="cat">{t('category')}</Label>
          <select
            id="cat"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="block w-full rounded-md border border-brand-border bg-brand-surface px-2 py-1.5 text-sm"
          >
            {EXERCISE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {locale === 'ar' ? c.labelAr : c.labelEn}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="reg">{t('anatomicalRegion')}</Label>
          <select
            id="reg"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className="block w-full rounded-md border border-brand-border bg-brand-surface px-2 py-1.5 text-sm"
          >
            {ANATOMICAL_REGIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {locale === 'ar' ? r.labelAr : r.labelEn}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="descEn">{t('descriptionEn')}</Label>
          <textarea
            id="descEn"
            value={descriptionEn}
            onChange={(e) => setDescriptionEn(e.target.value)}
            rows={4}
            required
            minLength={10}
            className="mt-1 block w-full rounded-md border border-brand-border bg-brand-surface p-2 text-sm"
          />
        </div>
        <div>
          <Label htmlFor="descAr">{t('descriptionAr')}</Label>
          <textarea
            id="descAr"
            value={descriptionAr}
            onChange={(e) => setDescriptionAr(e.target.value)}
            rows={4}
            required
            minLength={10}
            className="mt-1 block w-full rounded-md border border-brand-border bg-brand-surface p-2 text-sm"
          />
        </div>
      </section>

      <section>
        <Label htmlFor="contra">{t('contraindications')}</Label>
        <textarea
          id="contra"
          value={contraindications}
          onChange={(e) => setContraindications(e.target.value)}
          rows={2}
          className="mt-1 block w-full rounded-md border border-brand-border bg-brand-surface p-2 text-sm"
        />
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="instrEn">{t('defaultInstructionEn')}</Label>
          <textarea
            id="instrEn"
            value={defaultInstructionEn}
            onChange={(e) => setDefaultInstructionEn(e.target.value)}
            rows={3}
            className="mt-1 block w-full rounded-md border border-brand-border bg-brand-surface p-2 text-sm"
          />
        </div>
        <div>
          <Label htmlFor="instrAr">{t('defaultInstructionAr')}</Label>
          <textarea
            id="instrAr"
            value={defaultInstructionAr}
            onChange={(e) => setDefaultInstructionAr(e.target.value)}
            rows={3}
            className="mt-1 block w-full rounded-md border border-brand-border bg-brand-surface p-2 text-sm"
          />
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <MediaUploader
          kind="exercise_image"
          value={imageUrl}
          label={t('image')}
          onChange={(v) => {
            setImageUrl(v.url);
            setImageMimeType(v.mimeType);
            setImageSizeBytes(v.sizeBytes);
          }}
        />
        <MediaUploader
          kind="exercise_video"
          value={videoUrl}
          label={t('video')}
          onChange={(v) => {
            setVideoUrl(v.url);
            setVideoMimeType(v.mimeType);
            setVideoSizeBytes(v.sizeBytes);
          }}
        />
      </section>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={pending}>
          {initial ? t('saveAsNewVersion') : t('create')}
        </Button>
      </div>
      {initial ? (
        <p className="text-xs text-brand-textMuted">
          {t('versionNote', { version: initial.version })}
        </p>
      ) : null}
    </form>
  );
}
