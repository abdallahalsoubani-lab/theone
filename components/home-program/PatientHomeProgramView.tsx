import { Award } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { MarkAsDoneButton } from '@/components/home-program/MarkAsDoneButton';
import { Badge } from '@/components/ui/badge';
import type { HomeProgramItemRow } from '@/lib/clinical/home-program/queries';

const DAY_LABELS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LABELS_AR = ['أحد', 'إثن', 'ثلا', 'أرب', 'خمي', 'جمع', 'سبت'];

interface Props {
  todayItems: HomeProgramItemRow[];
  fullProgram: HomeProgramItemRow[];
  /** Today's completions, keyed by itemId. */
  todayCompletions: Map<string, Date | null>;
  /** Days-in-a-row banner. */
  streak: number;
  locale: 'en' | 'ar';
}

/**
 * Patient-facing home-program surface (Prompt 10 §4.6).
 *
 * Today's exercises are pinned at the top with the mark-as-done button.
 * The full program below shows everything in this patient's plan,
 * regardless of weekday. Each exercise card has the embedded video (if
 * available), the therapist's note (which is also the WhatsApp
 * reminder body), and sets/reps.
 */
export async function PatientHomeProgramView({
  todayItems,
  fullProgram,
  todayCompletions,
  streak,
  locale,
}: Props) {
  const t = await getTranslations('patient.homeProgram');
  const dayLabels = locale === 'ar' ? DAY_LABELS_AR : DAY_LABELS_EN;

  return (
    <section className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-medium text-brand-navy">{t('title')}</h1>
        {streak > 0 ? (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <Award className="size-4" />
            {t('streakBanner', { count: streak })}
          </div>
        ) : null}
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-brand-navy">{t('todayHeading')}</h2>
        {todayItems.length === 0 ? (
          <p className="rounded-md border border-brand-border bg-brand-bg p-4 text-sm text-brand-textMuted">
            {t('noToday')}
          </p>
        ) : (
          <ul className="space-y-3">
            {todayItems.map((item) => {
              const name = locale === 'ar' ? item.exerciseNameAr : item.exerciseNameEn;
              const description =
                locale === 'ar' ? item.exerciseDescriptionAr : item.exerciseDescriptionEn;
              const defaultInstruction =
                locale === 'ar'
                  ? item.exerciseDefaultInstructionAr
                  : item.exerciseDefaultInstructionEn;
              const completedAt = todayCompletions.get(item.id) ?? null;
              const alreadyDone = todayCompletions.has(item.id);
              return (
                <li
                  key={item.id}
                  className="space-y-3 overflow-hidden rounded-md border border-brand-border bg-brand-surface"
                >
                  {item.exerciseVideoUrl ? (
                    <video
                      src={item.exerciseVideoUrl}
                      controls
                      preload="metadata"
                      className="w-full"
                    >
                      <track kind="captions" />
                    </video>
                  ) : item.exerciseImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.exerciseImageUrl} alt="" className="w-full" />
                  ) : null}
                  <div className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-lg font-medium text-brand-navy">{name}</p>
                        <p className="text-xs text-brand-textMuted">
                          {item.scheduledTime} · {item.durationMinutes} {t('min')}
                          {item.setsReps ? ` · ${item.setsReps}` : ''}
                        </p>
                      </div>
                      <MarkAsDoneButton
                        itemId={item.id}
                        alreadyDoneToday={alreadyDone}
                        completedAt={completedAt}
                      />
                    </div>
                    {item.therapistNote ? (
                      <p className="rounded-md bg-brand-bg p-2 text-sm italic text-brand-text">
                        {item.therapistNote}
                      </p>
                    ) : null}
                    {defaultInstruction ? (
                      <p className="whitespace-pre-wrap text-sm text-brand-text">
                        {defaultInstruction}
                      </p>
                    ) : (
                      <p className="whitespace-pre-wrap text-sm text-brand-textMuted">
                        {description}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-brand-navy">{t('fullProgramHeading')}</h2>
        {fullProgram.length === 0 ? (
          <p className="rounded-md border border-brand-border bg-brand-bg p-4 text-sm text-brand-textMuted">
            {t('noProgram')}
          </p>
        ) : (
          <ul className="space-y-2">
            {fullProgram.map((item) => {
              const name = locale === 'ar' ? item.exerciseNameAr : item.exerciseNameEn;
              return (
                <li
                  key={item.id}
                  className="rounded-md border border-brand-border bg-brand-surface p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-brand-navy">{name}</p>
                    {!item.active ? <Badge variant="muted">{t('paused')}</Badge> : null}
                  </div>
                  <p className="mt-0.5 text-xs text-brand-textMuted">
                    {item.daysOfWeek.map((d) => dayLabels[d]).join(', ')} · {item.scheduledTime}
                    {item.setsReps ? ` · ${item.setsReps}` : ''}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </section>
  );
}
