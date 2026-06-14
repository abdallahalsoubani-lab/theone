'use client';

import { Link2, UserPlus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  approveSubmissionLinkAction,
  approveSubmissionNewAction,
  rejectSubmissionAction,
} from '@/lib/intake-submissions/actions';

interface Duplicate {
  patientId: string;
  name: string;
  phone: string;
}

interface Props {
  submissionId: string;
  locale: 'en' | 'ar';
  duplicate: Duplicate | null;
}

/**
 * Approve / link / reject controls for one pending submission (Prompt 23 §4).
 * When the submitted phone matches an existing patient, the primary action is
 * "link to existing" to avoid a duplicate; "create new anyway" stays available
 * for the genuine same-phone-different-person case.
 */
export function SubmissionReviewActions({ submissionId, locale, duplicate }: Props) {
  const t = useTranslations('intakeSubmissions');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState('');
  const [showReject, setShowReject] = useState(false);

  const toPatient = (patientId: string) =>
    router.push(`/${locale}/secretary/patients/${patientId}`);

  function approveNew() {
    startTransition(async () => {
      const res = await approveSubmissionNewAction({ submissionId });
      if (!res.ok) {
        toast.error(locale === 'ar' ? res.error.message_ar : res.error.message_en);
        return;
      }
      toast.success(t('approvedNewToast'));
      toPatient(res.data.patientId);
    });
  }

  function approveLink() {
    if (!duplicate) return;
    startTransition(async () => {
      const res = await approveSubmissionLinkAction({
        submissionId,
        patientId: duplicate.patientId,
      });
      if (!res.ok) {
        toast.error(locale === 'ar' ? res.error.message_ar : res.error.message_en);
        return;
      }
      toast.success(t('linkedToast'));
      toPatient(res.data.patientId);
    });
  }

  function reject() {
    startTransition(async () => {
      const res = await rejectSubmissionAction({ submissionId, reason });
      if (!res.ok) {
        toast.error(locale === 'ar' ? res.error.message_ar : res.error.message_en);
        return;
      }
      toast.success(t('rejectedToast'));
      router.push(`/${locale}/secretary/intake-submissions`);
    });
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        {duplicate ? (
          <div className="rounded-md border border-brand-cyan/40 bg-brand-cyan/5 p-3 text-sm">
            <p className="font-medium text-brand-navy">{t('duplicateFound')}</p>
            <p className="text-brand-textMuted">
              {duplicate.name} · {duplicate.phone}
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {duplicate ? (
            <>
              <Button type="button" onClick={approveLink} disabled={pending}>
                <Link2 className="me-2 size-4" />
                {t('linkExisting')}
              </Button>
              <Button type="button" variant="outline" onClick={approveNew} disabled={pending}>
                <UserPlus className="me-2 size-4" />
                {t('approveNewAnyway')}
              </Button>
            </>
          ) : (
            <Button type="button" onClick={approveNew} disabled={pending}>
              <UserPlus className="me-2 size-4" />
              {t('approveNew')}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            className="text-red-600"
            onClick={() => setShowReject((s) => !s)}
            disabled={pending}
          >
            <X className="me-2 size-4" />
            {t('reject')}
          </Button>
        </div>

        {showReject ? (
          <div className="space-y-2 rounded-md border border-brand-border p-3">
            <label className="block text-sm text-brand-textMuted" htmlFor="reject-reason">
              {t('rejectReasonLabel')}
            </label>
            <textarea
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={2}
              className="w-full rounded-md border border-brand-border bg-brand-bg p-2 text-sm"
            />
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={reject}
              disabled={pending}
            >
              {t('confirmReject')}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
