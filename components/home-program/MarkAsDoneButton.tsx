'use client';

import { Check } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { markHomeExerciseDoneAction } from '@/lib/clinical/home-program/actions';

interface Props {
  itemId: string;
  /** True when the patient has already marked today's occurrence done. */
  alreadyDoneToday: boolean;
  completedAt: Date | null;
}

/**
 * One-tap completion button + optional pain-score input. Mark-as-done
 * is idempotent server-side (upsert), so double-tap on mobile is safe.
 */
export function MarkAsDoneButton({ itemId, alreadyDoneToday, completedAt }: Props) {
  const t = useTranslations('patient.homeProgram');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [askingPainScore, setAskingPainScore] = useState(false);
  const [pain, setPain] = useState<number | null>(null);
  const [done, setDone] = useState(alreadyDoneToday);

  function submit(painScore: number | null) {
    startTransition(async () => {
      const r = await markHomeExerciseDoneAction({ itemId, painScore });
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      setDone(true);
      setAskingPainScore(false);
      toast.success(t('doneToast'));
      router.refresh();
    });
  }

  if (done) {
    const time = completedAt
      ? completedAt.toLocaleTimeString(locale === 'ar' ? 'ar' : 'en', {
          hour: '2-digit',
          minute: '2-digit',
        })
      : '';
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-3 py-1.5 text-sm font-medium text-emerald-900">
        <Check className="size-4" />
        {time ? t('completedAt', { time }) : t('completed')}
      </span>
    );
  }

  if (askingPainScore) {
    return (
      <div className="space-y-2 rounded-md border border-brand-border bg-brand-bg p-2">
        <p className="text-xs text-brand-textMuted">{t('painScorePrompt')}</p>
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: 11 }, (_, i) => i).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setPain(v)}
              className={`h-7 w-7 rounded-md border text-xs font-medium transition-colors ${
                pain === v
                  ? 'border-brand-cyan bg-brand-cyan text-white'
                  : 'border-brand-border bg-brand-surface text-brand-text hover:bg-brand-bg'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => submit(null)}
            disabled={pending}
          >
            {t('skip')}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => submit(pain)}
            disabled={pending || pain == null}
          >
            {t('save')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button type="button" size="sm" onClick={() => setAskingPainScore(true)} disabled={pending}>
      <Check className="me-1 size-4" />
      {t('markDone')}
    </Button>
  );
}
