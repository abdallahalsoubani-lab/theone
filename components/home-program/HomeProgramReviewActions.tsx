'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';
import {
  approveHomeProgramAction,
  requestHomeProgramChangesAction,
} from '@/lib/clinical/home-program/actions';

/**
 * Approve / return-to-therapist, shared by the approvals queue card and the
 * review page (PT-B2 item 3) so both decide the same way with one set of
 * rules. Returning requires a comment — the therapist needs to know what to
 * change.
 *
 * `afterAction` decides where the reviewer lands: the queue card refreshes in
 * place (the row disappears), the review page goes back to the queue so the
 * doctor keeps working through it instead of hitting a dead end.
 */
export function HomeProgramReviewActions({
  patientId,
  afterAction = 'refresh',
}: {
  patientId: string;
  afterAction?: 'refresh' | 'backToQueue';
}) {
  const t = useTranslations('clinical.homeProgram.approval');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showChanges, setShowChanges] = useState(false);
  const [comment, setComment] = useState('');

  const errorText = (e: { message_en: string; message_ar: string }) =>
    locale === 'ar' ? e.message_ar : e.message_en;

  function done() {
    if (afterAction === 'backToQueue') router.push('/doctor/approvals');
    else router.refresh();
  }

  function handleApprove() {
    startTransition(async () => {
      // Approving takes whatever is live right now, so a doctor who edited on
      // this page approves their own edits in the same step — no separate
      // "I changed it but never approved" state (PT-B2 item 3).
      const r = await approveHomeProgramAction(patientId);
      if (!r.ok) {
        toast.error(errorText(r.error));
        return;
      }
      toast.success(t('approvedToast'));
      done();
    });
  }

  function handleRequestChanges() {
    if (!comment.trim()) {
      toast.error(t('commentRequired'));
      return;
    }
    startTransition(async () => {
      const r = await requestHomeProgramChangesAction(patientId, comment);
      if (!r.ok) {
        toast.error(errorText(r.error));
        return;
      }
      toast.success(t('changesRequestedToast'));
      done();
    });
  }

  if (showChanges) {
    return (
      <div className="space-y-2">
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          placeholder={t('commentPlaceholder')}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={pending} onClick={handleRequestChanges}>
            {t('sendChanges')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowChanges(false)}>
            {t('cancel')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={pending} onClick={handleApprove}>
        {t('approve')}
      </Button>
      <Button size="sm" variant="outline" onClick={() => setShowChanges(true)}>
        {t('requestChanges')}
      </Button>
    </div>
  );
}
