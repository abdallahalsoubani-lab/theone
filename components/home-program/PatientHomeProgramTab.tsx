import { Pencil, Plus } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { ComplianceWidget } from '@/components/home-program/ComplianceWidget';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import type { ComplianceResult } from '@/lib/clinical/compliance/calculate';
import type { HomeProgramItemRow } from '@/lib/clinical/home-program/queries';
import type { ApprovalState } from '@/lib/clinical/home-program/visibility';
import { formatShortDate } from '@/lib/format/date';

interface Props {
  patientId: string;
  /** The APPROVED program only — a draft revision never renders here as the
   *  patient's program (PT-B2 item 1). */
  items: HomeProgramItemRow[];
  approval: ApprovalState;
  /** Items in the clinicians' working draft, approved or not. */
  draftItemCount: number;
  sevenDay: ComplianceResult;
  thirtyDay: ComplianceResult;
  streak: number;
  /** Last-completed timestamp per item (within the 30-day window). */
  lastCompletedById: Map<string, Date>;
  /** True when the viewer is the patient's assigned therapist (or Doctor/Admin). */
  canEdit: boolean;
  /** Role-scoped builder link (Doctor vs Therapist route). */
  editHref?: string;
  locale: 'en' | 'ar';
}

const DAY_LABELS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LABELS_AR = ['أحد', 'إثن', 'ثلا', 'أرب', 'خمي', 'جمع', 'سبت'];

/**
 * Patient-file Home Program tab (clinician-facing, read-mostly).
 * Compliance stats up top, the APPROVED program below with an Edit link to
 * the builder. A draft revision is announced but never rendered here as the
 * program — the builder behind the Edit link is where drafts live.
 */
export async function PatientHomeProgramTab({
  patientId,
  items,
  approval,
  draftItemCount,
  sevenDay,
  thirtyDay,
  streak,
  lastCompletedById,
  canEdit,
  editHref,
  locale,
}: Props) {
  const t = await getTranslations('clinical.compliance');
  const tHp = await getTranslations('clinical.homeProgram');
  const tApproval = await getTranslations('clinical.homeProgram.approval');
  const dayLabels = locale === 'ar' ? DAY_LABELS_AR : DAY_LABELS_EN;
  const localeTag = locale === 'ar' ? 'ar' : 'en';
  // A revision is outstanding whenever the working draft is not the approved
  // content: any non-APPROVED status with items in the builder.
  const revisionPending = approval.status !== 'APPROVED' && draftItemCount > 0;

  return (
    <div className="space-y-4">
      <ComplianceWidget sevenDay={sevenDay} thirtyDay={thirtyDay} streak={streak} />

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-brand-navy">{tHp('approvedProgram')}</h3>
            {items.length > 0 ? <Badge variant="teal">{tApproval('statusApproved')}</Badge> : null}
          </div>
          {canEdit ? (
            <Button asChild size="sm" variant="outline">
              <Link
                href={
                  (editHref ?? `/therapist/patients/${patientId}/home-program/edit`) as `/${string}`
                }
              >
                {/* The action reflects the actual operation (QA 6.2): with no
                    program yet the builder opens in add mode → "Add exercise";
                    with items it opens the editable list → "Edit". Keyed to
                    the DRAFT count — that is what the builder will show. */}
                {draftItemCount === 0 ? (
                  <>
                    <Plus className="me-1 size-4" />
                    {tHp('addExercise')}
                  </>
                ) : (
                  <>
                    <Pencil className="me-1 size-4" />
                    {tHp('edit')}
                  </>
                )}
              </Link>
            </Button>
          ) : null}
        </div>
        {/* A draft / submitted revision is announced, never rendered as the
            program: what the patient follows is only ever the approved list. */}
        {revisionPending ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-brand-cyan/40 bg-brand-cyan/5 p-3 text-sm text-brand-navy">
            <Badge variant={approval.status === 'PENDING_APPROVAL' ? 'cyan' : 'muted'}>
              {tApproval(
                approval.status === 'PENDING_APPROVAL'
                  ? 'statusPending'
                  : approval.status === 'CHANGES_REQUESTED'
                    ? 'statusChanges'
                    : 'statusDraft',
              )}
            </Badge>
            <p>
              {approval.status === 'PENDING_APPROVAL'
                ? tHp('revisionPendingNote')
                : tHp('revisionDraftNote')}
            </p>
          </div>
        ) : null}
        {items.length === 0 ? (
          <p className="rounded-md border border-brand-border bg-brand-bg p-4 text-sm text-brand-textMuted">
            {revisionPending ? tHp('emptyTabAwaitingApproval') : tHp('emptyTab')}
          </p>
        ) : (
          <ul className="divide-y divide-brand-border overflow-hidden rounded-md border border-brand-border bg-brand-surface text-sm">
            {items.map((item) => {
              const name = localeTag === 'ar' ? item.exerciseNameAr : item.exerciseNameEn;
              const last = lastCompletedById.get(item.id);
              return (
                <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <p className="font-medium text-brand-navy">{name}</p>
                    <p className="text-xs text-brand-textMuted">
                      {item.daysOfWeek.map((d) => dayLabels[d]).join(', ')} · {item.scheduledTime}
                      {item.setsReps ? ` · ${item.setsReps}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {!item.active ? <Badge variant="muted">{tHp('paused')}</Badge> : null}
                    <p className="text-xs text-brand-textMuted">
                      {t('lastCompleted')}: {last ? formatShortDate(last, localeTag) : '—'}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
