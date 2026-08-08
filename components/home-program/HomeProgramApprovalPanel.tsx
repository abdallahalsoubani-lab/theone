'use client';

import type { HomeProgramStatus } from '@prisma/client';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  setHomeProgramRemindersAction,
  submitHomeProgramAction,
} from '@/lib/clinical/home-program/actions';
import { canSubmitHomeProgram } from '@/lib/clinical/home-program/policy';
import { formatDateTime } from '@/lib/format/date';

const STATUS_BADGE: Record<
  HomeProgramStatus,
  { key: string; variant: 'muted' | 'cyan' | 'teal' | 'destructive' }
> = {
  DRAFT: { key: 'statusDraft', variant: 'muted' },
  PENDING_APPROVAL: { key: 'statusPending', variant: 'cyan' },
  APPROVED: { key: 'statusApproved', variant: 'teal' },
  CHANGES_REQUESTED: { key: 'statusChanges', variant: 'destructive' },
};

/**
 * Approval panel on the home-program builder (Prompt 16): the status badge,
 * the doctor's changes-requested comment, the therapist's Submit-for-approval
 * button, and the WhatsApp reminders toggle.
 */
export function HomeProgramApprovalPanel({
  patientId,
  status,
  remindersEnabled,
  changesComment,
  canSubmit,
  itemCount = 0,
  hasApprovedSnapshot = false,
  submittedAt = null,
}: {
  patientId: string;
  status: HomeProgramStatus;
  remindersEnabled: boolean;
  changesComment: string | null;
  /** True for the THERAPIST view (shows the Submit button). */
  canSubmit: boolean;
  /** Exercises in the working draft. An empty program has nothing to send, so
   *  the button stays visible but disabled with a hint (PT-B2 item 2) — an
   *  absent button is what the QA round read as a missing feature. */
  itemCount?: number;
  /** True when a frozen approved snapshot exists — a DRAFT then means the
   *  patient still sees the last approved version (QA 7.8 hint). */
  hasApprovedSnapshot?: boolean;
  /** When the program was sent for review — the PENDING explainer (P-2,
   *  Prompt 43) tells the therapist it's already submitted, not missing a
   *  submit button. */
  submittedAt?: Date | null;
}) {
  const t = useTranslations('clinical.homeProgram.approval');
  const locale = useLocale();
  const intlLocale: 'en' | 'ar' = locale === 'ar' ? 'ar' : 'en';
  const router = useRouter();
  const [reminders, setReminders] = useState(remindersEnabled);
  const [pending, startTransition] = useTransition();
  const badge = STATUS_BADGE[status];
  // One rule shared with the server-side submit guard (P-2, Prompt 43).
  const submittable = canSubmit && canSubmitHomeProgram(status);
  const nothingToSend = submittable && itemCount === 0;

  function handleSubmit() {
    startTransition(async () => {
      const r = await submitHomeProgramAction(patientId);
      if (!r.ok) {
        toast.error(intlLocale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(t('submittedToast'));
      router.refresh();
    });
  }

  function handleReminders(next: boolean) {
    setReminders(next);
    startTransition(async () => {
      const r = await setHomeProgramRemindersAction(patientId, next);
      if (!r.ok) {
        setReminders(!next);
        toast.error(intlLocale === 'ar' ? r.error.message_ar : r.error.message_en);
      }
    });
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-brand-navy">{t('statusLabel')}</span>
            <Badge variant={badge.variant}>{t(badge.key)}</Badge>
          </div>
          {submittable ? (
            <Button size="sm" disabled={pending || nothingToSend} onClick={handleSubmit}>
              {t('submit')}
            </Button>
          ) : null}
        </div>

        {/* The whole point of the gate: until this is sent and approved, the
            program is not the patient's. Say so next to the button. */}
        {submittable ? (
          <p className="text-sm text-brand-textMuted">
            {nothingToSend ? t('submitNeedsItems') : t('submitHint')}
          </p>
        ) : null}

        {/* P-2 (Prompt 43): PENDING means "already sent — the doctor has it".
            Without this line the missing submit button read as a bug. */}
        {status === 'PENDING_APPROVAL' ? (
          <div className="rounded-md border border-brand-cyan/40 bg-brand-cyan/5 p-3 text-sm text-brand-navy">
            <p>
              {submittedAt
                ? t('pendingExplainer', { date: formatDateTime(submittedAt, intlLocale) })
                : t('pendingExplainerNoDate')}
            </p>
          </div>
        ) : null}

        {status === 'CHANGES_REQUESTED' && changesComment ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">{t('changesRequestedTitle')}</p>
            <p className="mt-1 whitespace-pre-wrap">{changesComment}</p>
          </div>
        ) : null}

        {status === 'DRAFT' && hasApprovedSnapshot ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p>{t('draftRevisionNote')}</p>
          </div>
        ) : null}

        <label className="flex items-center gap-2 text-sm text-brand-text">
          <input
            type="checkbox"
            checked={reminders}
            disabled={pending}
            onChange={(e) => handleReminders(e.target.checked)}
            className="size-4 rounded border-brand-border"
          />
          {t('remindersLabel')}
        </label>
      </CardContent>
    </Card>
  );
}
