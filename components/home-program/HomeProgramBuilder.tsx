'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { HomeProgramItemForm } from '@/components/home-program/HomeProgramItemForm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  deleteHomeProgramItemAction,
  setHomeProgramItemActiveAction,
} from '@/lib/clinical/home-program/actions';
import type { HomeProgramItemRow } from '@/lib/clinical/home-program/queries';
import type { ExerciseOption } from '@/lib/clinical/plans/exercises';

interface Props {
  patientId: string;
  items: HomeProgramItemRow[];
  exerciseOptions: ExerciseOption[];
}

const DAY_LABELS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LABELS_AR = ['أحد', 'إثن', 'ثلا', 'أرب', 'خمي', 'جمع', 'سبت'];

/**
 * Two-column builder: existing items on the left, add-new form on the
 * right (when expanded). Per-item edit toggles in place. Compact —
 * the patient file Home Program tab uses the same data via
 * HomeProgramItemCard but read-only.
 */
export function HomeProgramBuilder({ patientId, items, exerciseOptions }: Props) {
  const t = useTranslations('clinical.homeProgram');
  const locale = useLocale();
  const router = useRouter();
  const [adding, setAdding] = useState(items.length === 0);
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleDelete(id: string) {
    if (!window.confirm(t('confirmDelete'))) return;
    startTransition(async () => {
      const r = await deleteHomeProgramItemAction(id);
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(t('deletedToast'));
      router.refresh();
    });
  }

  function handleToggleActive(id: string, active: boolean) {
    startTransition(async () => {
      const r = await setHomeProgramItemActiveAction({ id, active });
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(active ? t('resumedToast') : t('pausedToast'));
      router.refresh();
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-brand-navy">{t('currentProgram')}</h2>
          {!adding ? (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus className="me-1 size-4" />
              {t('addExercise')}
            </Button>
          ) : null}
        </div>
        {items.length === 0 ? (
          <p className="rounded-md border border-brand-border bg-brand-bg p-4 text-sm text-brand-textMuted">
            {t('emptyBuilder')}
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => {
              const name = locale === 'ar' ? item.exerciseNameAr : item.exerciseNameEn;
              const dayLabels = locale === 'ar' ? DAY_LABELS_AR : DAY_LABELS_EN;
              return (
                <li
                  key={item.id}
                  className="space-y-2 rounded-md border border-brand-border bg-brand-surface p-3"
                >
                  {editing === item.id ? (
                    <HomeProgramItemForm
                      patientId={patientId}
                      exerciseOptions={exerciseOptions}
                      initial={item}
                      onDone={() => setEditing(null)}
                    />
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-brand-navy">{name}</p>
                          <p className="mt-0.5 text-xs text-brand-textMuted">
                            {item.daysOfWeek.map((d) => dayLabels[d]).join(', ')} ·{' '}
                            {item.scheduledTime} · {item.durationMinutes}min
                            {item.setsReps ? ` · ${item.setsReps}` : ''}
                          </p>
                          {item.therapistNote ? (
                            <p className="mt-1 text-xs italic text-brand-text">
                              {item.therapistNote}
                            </p>
                          ) : null}
                        </div>
                        {!item.active ? <Badge variant="muted">{t('paused')}</Badge> : null}
                      </div>
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setEditing(item.id)}
                        >
                          {t('edit')}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleToggleActive(item.id, !item.active)}
                          disabled={pending}
                        >
                          {item.active ? t('pause') : t('resume')}
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDelete(item.id)}
                          disabled={pending}
                          aria-label={t('delete')}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {adding ? (
        <aside>
          <h2 className="mb-2 text-sm font-semibold text-brand-navy">{t('newItem')}</h2>
          <HomeProgramItemForm
            patientId={patientId}
            exerciseOptions={exerciseOptions}
            onDone={() => setAdding(false)}
          />
        </aside>
      ) : null}
    </div>
  );
}
