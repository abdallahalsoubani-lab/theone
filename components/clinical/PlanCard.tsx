'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import {
  approveProposalAction,
  completePlanAction,
  discontinuePlanAction,
  pausePlanAction,
  rejectProposalAction,
} from '@/lib/clinical/plans/actions';
import type { PlanCardRow } from '@/lib/clinical/plans/queries';

interface Props {
  plan: PlanCardRow;
  /** Viewer's role gates which actions are visible. */
  viewerRole: 'DOCTOR' | 'THERAPIST' | 'SECRETARY' | 'ADMIN' | 'PATIENT';
  /** Optional base path for "Edit" / "Propose" links — varies per role. */
  editHref?: string;
}

/**
 * Treatment-plan summary card used on the patient file Plan tab + on
 * the dedicated plan view pages. Renders diagnosis, goals, schedule,
 * assigned therapist, exercise list, and the lifecycle actions
 * available to the viewer's role.
 *
 * The action surface adapts to the plan's status: ACTIVE plans expose
 * pause/complete/discontinue (Doctor) and Edit (Doctor) / Propose
 * change (Therapist); PROPOSED plans expose Approve + Reject (Doctor)
 * or "Pending approval" (Therapist); terminal statuses
 * (SUPERSEDED/REJECTED/COMPLETED/DISCONTINUED) are read-only.
 */
export function PlanCard({ plan, viewerRole, editHref }: Props) {
  const t = useTranslations('clinical.plans');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const isDoctor = viewerRole === 'DOCTOR' || viewerRole === 'ADMIN';
  const isAssignedTherapist = viewerRole === 'THERAPIST'; // narrower check happens server-side

  function onAction(
    fn: () => Promise<{ ok: boolean; error?: { message_en: string; message_ar: string } }>,
    success: string,
  ) {
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        const err = r.error ?? { message_en: 'Error', message_ar: 'خطأ' };
        toast.error(locale === 'ar' ? err.message_ar : err.message_en);
        return;
      }
      toast.success(success);
      router.refresh();
    });
  }

  function handleReject() {
    if (rejectReason.trim().length < 5) {
      toast.error(t('errors.rejectReason'));
      return;
    }
    onAction(
      () =>
        rejectProposalAction({
          proposedPlanId: plan.id,
          rejectedReason: rejectReason,
        }),
      t('rejectedToast'),
    );
    setRejecting(false);
    setRejectReason('');
  }

  const patientName = locale === 'ar' ? plan.patientFullNameAr : plan.patientFullNameEn;
  const therapistName = locale === 'ar' ? plan.therapistFullNameAr : plan.therapistFullNameEn;
  const doctorName = locale === 'ar' ? plan.doctorFullNameAr : plan.doctorFullNameEn;

  return (
    <article className="space-y-4 rounded-md border border-brand-border bg-brand-surface p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-medium text-brand-navy">
              {t('plan')}{' '}
              <span className="font-mono text-sm text-brand-textMuted">v{plan.version}</span>
            </h3>
            <StatusBadge status={plan.status} />
          </div>
          <p className="mt-1 text-xs text-brand-textMuted">
            {t('forPatient')} {patientName} · {t('by')} {doctorName}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {plan.status === 'PROPOSED' && isDoctor && plan.doctorId ? (
            <>
              <Button
                type="button"
                size="sm"
                disabled={pending}
                onClick={() => onAction(() => approveProposalAction(plan.id), t('approvedToast'))}
              >
                {t('approve')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => setRejecting(true)}
              >
                {t('reject')}
              </Button>
            </>
          ) : null}
          {plan.status === 'PROPOSED' && isAssignedTherapist ? (
            <Badge variant="outline">{t('pendingApproval')}</Badge>
          ) : null}
          {plan.status === 'ACTIVE' && isDoctor ? (
            <>
              {editHref ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={editHref}>{t('edit')}</Link>
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => onAction(() => pausePlanAction(plan.id), t('pausedToast'))}
              >
                {t('pause')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => onAction(() => completePlanAction(plan.id), t('completedToast'))}
              >
                {t('markComplete')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={pending}
                onClick={() =>
                  onAction(() => discontinuePlanAction(plan.id), t('discontinuedToast'))
                }
              >
                {t('discontinue')}
              </Button>
            </>
          ) : null}
          {plan.status === 'ACTIVE' && isAssignedTherapist && editHref ? (
            <Button asChild size="sm">
              <Link href={editHref}>{t('proposeChange')}</Link>
            </Button>
          ) : null}
        </div>
      </header>

      {rejecting ? (
        <div className="rounded-md border border-brand-border bg-brand-bg p-3">
          <label className="block text-xs text-brand-textMuted">{t('rejectReasonLabel')}</label>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={2}
            className="mt-1 block w-full rounded-md border border-brand-border bg-brand-surface p-2 text-sm"
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRejecting(false)}
              disabled={pending}
            >
              {t('cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleReject}
              disabled={pending || rejectReason.trim().length < 5}
            >
              {t('confirmReject')}
            </Button>
          </div>
        </div>
      ) : null}

      {plan.proposalReason ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>{t('proposalReason')}:</strong> {plan.proposalReason}
        </div>
      ) : null}
      {plan.rejectedReason ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <strong>{t('rejectedReason')}:</strong> {plan.rejectedReason}
        </div>
      ) : null}

      <dl className="grid gap-3 sm:grid-cols-2">
        <Field label={t('diagnosisPrimary')} value={plan.diagnosisPrimary} />
        <Field label={t('diagnosisSecondary')} value={plan.diagnosisSecondary ?? '—'} />
        <Field label={t('goalsShort')} value={plan.goalsShortTerm} />
        <Field label={t('goalsLong')} value={plan.goalsLongTerm || '—'} />
        <Field
          label={t('schedule')}
          value={`${plan.frequencyPerWeek}× / ${t('weekShort')} × ${plan.durationWeeks} ${t('weeks')}`}
        />
        <Field label={t('assignedTherapist')} value={therapistName} />
      </dl>

      {plan.therapistNotes ? (
        <Field label={t('therapistNotes')} value={plan.therapistNotes} />
      ) : null}

      <section>
        <h4 className="mb-2 text-sm font-semibold text-brand-navy">{t('exercises')}</h4>
        {plan.exercises.length === 0 ? (
          <p className="text-sm text-brand-textMuted">{t('noExercises')}</p>
        ) : (
          <ol className="space-y-1 text-sm">
            {plan.exercises.map((ex) => (
              <li key={ex.id} className="flex flex-wrap gap-2 text-brand-text">
                <span className="font-medium text-brand-navy">
                  {locale === 'ar' ? ex.exerciseNameAr : ex.exerciseNameEn}
                </span>
                <span className="text-brand-textMuted">
                  {ex.sets} × {ex.reps}
                  {ex.durationSeconds > 0 ? ` · ${ex.durationSeconds}s` : ''}
                </span>
                {ex.customNotes ? (
                  <span className="text-brand-textMuted">— {ex.customNotes}</span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </article>
  );
}

function StatusBadge({ status }: { status: PlanCardRow['status'] }) {
  const t = useTranslations('clinical.plans.status');
  switch (status) {
    case 'ACTIVE':
      return <Badge variant="default">{t('ACTIVE')}</Badge>;
    case 'PROPOSED':
      return <Badge variant="outline">{t('PROPOSED')}</Badge>;
    case 'REJECTED':
      return <Badge variant="destructive">{t('REJECTED')}</Badge>;
    case 'SUPERSEDED':
      return <Badge variant="muted">{t('SUPERSEDED')}</Badge>;
    case 'PAUSED':
      return <Badge variant="outline">{t('PAUSED')}</Badge>;
    case 'COMPLETED':
      return <Badge variant="muted">{t('COMPLETED')}</Badge>;
    case 'DISCONTINUED':
      return <Badge variant="destructive">{t('DISCONTINUED')}</Badge>;
    default:
      return <Badge variant="muted">{status}</Badge>;
  }
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-brand-textMuted">{label}</dt>
      <dd className="whitespace-pre-wrap text-sm text-brand-text">{value ?? '—'}</dd>
    </div>
  );
}
