'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { createDoctorReviewAction } from '@/lib/clinical/doctor-reviews/actions';

interface Props {
  patientId: string;
  /** YYYY-MM-DD of the week start (Monday). */
  weekStarting: string;
}

/**
 * Doctor's weekly comment composer (Prompt 9 §4.10).
 *
 * One per patient block on the weekly review page. Reviews are
 * immutable once submitted — if the doctor needs to amend, they
 * submit a second review for the same patient/week.
 */
export function DoctorReviewComposer({ patientId, weekStarting }: Props) {
  const t = useTranslations('clinical.reports');
  const locale = useLocale();
  const router = useRouter();
  const [comment, setComment] = useState('');
  const [pending, startTransition] = useTransition();

  function submit() {
    if (comment.trim().length < 10) {
      toast.error(t('commentMinLength'));
      return;
    }
    startTransition(async () => {
      const r = await createDoctorReviewAction({ patientId, weekStarting, comment });
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(t('reviewAddedToast'));
      setComment('');
      router.refresh();
    });
  }

  return (
    <div className="space-y-2 rounded-md border border-brand-border bg-brand-bg p-3">
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={3}
        placeholder={t('reviewPlaceholder')}
        className="block w-full rounded-md border border-brand-border bg-brand-surface p-2 text-sm"
      />
      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={submit} disabled={pending}>
          {t('addReview')}
        </Button>
      </div>
    </div>
  );
}
