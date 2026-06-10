'use client';

import type { HomeProgramStatus } from '@prisma/client';
import { useTranslations } from 'next-intl';
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
}: {
  patientId: string;
  status: HomeProgramStatus;
  remindersEnabled: boolean;
  changesComment: string | null;
  /** True for the THERAPIST view (shows the Submit button). */
  canSubmit: boolean;
}) {
  const t = useTranslations('clinical.homeProgram.approval');
  const router = useRouter();
  const [reminders, setReminders] = useState(remindersEnabled);
  const [pending, startTransition] = useTransition();
  const badge = STATUS_BADGE[status];
  const submittable = canSubmit && (status === 'DRAFT' || status === 'CHANGES_REQUESTED');

  function handleSubmit() {
    startTransition(async () => {
      const r = await submitHomeProgramAction(patientId);
      if (!r.ok) {
        toast.error(r.error.message_en);
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
        toast.error(r.error.message_en);
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
            <Button size="sm" disabled={pending} onClick={handleSubmit}>
              {t('submit')}
            </Button>
          ) : null}
        </div>

        {status === 'CHANGES_REQUESTED' && changesComment ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">{t('changesRequestedTitle')}</p>
            <p className="mt-1 whitespace-pre-wrap">{changesComment}</p>
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
