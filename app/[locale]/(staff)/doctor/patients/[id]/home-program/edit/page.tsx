import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { HomeProgramApprovalPanel } from '@/components/home-program/HomeProgramApprovalPanel';
import { HomeProgramBuilder } from '@/components/home-program/HomeProgramBuilder';
import { HomeProgramReviewActions } from '@/components/home-program/HomeProgramReviewActions';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { getApprovalState } from '@/lib/clinical/home-program/approval';
import { listHomeProgramForPatient } from '@/lib/clinical/home-program/queries';
import { listExerciseOptionsIncluding } from '@/lib/clinical/plans/exercises';
import { db } from '@/lib/db';
import { bidiIsolate } from '@/lib/format/bidi';
import { formatDateTime } from '@/lib/format/date';
import { ensureCanReadPatient } from '@/lib/patients/access';
import { requirePermission } from '@/lib/rbac/guards';

/**
 * Doctor home-program page — builder AND review surface (Prompt 16; unified in
 * PT-B2 item 3).
 *
 * Two modes, one page:
 *   - No submission pending: the doctor authors the program directly and their
 *     edits auto-approve (the doctor is the approver), so no Submit button.
 *   - A therapist's revision is PENDING_APPROVAL: the whole program is on
 *     screen, editable in place, with Approve / Return-to-therapist right
 *     here. Editing no longer silently approves — the doctor decides
 *     explicitly, and approving takes the edits with it in one step. That
 *     removes the reported dead end: review → edit → no way back to approve.
 */
export default async function DoctorHomeProgramEditPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission('home_program.create');
  await ensureCanReadPatient(id);
  const t = await getTranslations('clinical.homeProgram');
  const tApproval = await getTranslations('clinical.homeProgram.approval');

  const [patient, items, approval, submission] = await Promise.all([
    db.user.findUnique({
      where: { id },
      select: { id: true, fullNameEn: true, fullNameAr: true, role: true },
    }),
    listHomeProgramForPatient(id),
    getApprovalState(id),
    db.homeProgramApproval.findUnique({
      where: { patientId: id },
      select: { submittedBy: { select: { fullNameEn: true, fullNameAr: true } } },
    }),
  ]);
  if (!patient || patient.role !== 'PATIENT') notFound();
  // Active catalog + the versions the existing items already reference, so
  // items pointing at archived exercises keep resolving in the picker (6.3).
  const exerciseOptions = await listExerciseOptionsIncluding(items.map((i) => i.exerciseId));

  const patientName = locale === 'ar' ? patient.fullNameAr : patient.fullNameEn;
  const intlLocale: 'en' | 'ar' = locale === 'ar' ? 'ar' : 'en';
  const underReview = approval.status === 'PENDING_APPROVAL';
  const submitterName =
    (locale === 'ar' ? submission?.submittedBy?.fullNameAr : submission?.submittedBy?.fullNameEn) ??
    '—';

  return (
    <section className="space-y-6 p-6">
      <header>
        {underReview ? (
          <Link
            href="/doctor/approvals"
            className="text-xs text-brand-cyan hover:underline"
            // Always a way back to the queue — never a one-way trip into the
            // builder (PT-B2 item 3).
          >
            ← {tApproval('backToQueue')}
          </Link>
        ) : null}
        <h1 className="mt-1 text-2xl font-medium text-brand-navy">
          {underReview
            ? tApproval('reviewTitle', { name: patientName })
            : t('builderTitle', { name: patientName })}
        </h1>
        <p className="mt-1 text-sm text-brand-textMuted">
          {underReview
            ? `${tApproval('submittedBy', { name: bidiIsolate(submitterName) })}${
                approval.submittedAt ? ` · ${formatDateTime(approval.submittedAt, intlLocale)}` : ''
              } · ${tApproval('itemCount', { count: items.length })}`
            : t('builderSubtitle')}
        </p>
      </header>

      {/* The decision sits with the program, above and below it, so it is
          reachable whether the doctor read the list first or edited first. */}
      {underReview ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="text-sm text-brand-navy">{tApproval('reviewExplainer')}</p>
            <HomeProgramReviewActions patientId={patient.id} afterAction="backToQueue" />
          </CardContent>
        </Card>
      ) : null}

      <HomeProgramApprovalPanel
        patientId={patient.id}
        status={approval.status}
        remindersEnabled={approval.remindersEnabled}
        changesComment={approval.changesComment}
        itemCount={items.length}
        canSubmit={false}
        hasApprovedSnapshot={approval.hasApprovedSnapshot}
        submittedAt={approval.submittedAt}
      />
      <HomeProgramBuilder patientId={patient.id} items={items} exerciseOptions={exerciseOptions} />

      {underReview ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="text-sm text-brand-navy">{tApproval('reviewDecideAfterEdit')}</p>
            <HomeProgramReviewActions patientId={patient.id} afterAction="backToQueue" />
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}
