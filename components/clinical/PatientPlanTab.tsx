import { Plus } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';

import { PlanCard } from '@/components/clinical/PlanCard';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import type { PatientPlanState } from '@/lib/clinical/plans/queries';
import { planEditHref, planHref } from '@/lib/clinical/role-links';
import { formatShortDate } from '@/lib/format/date';

interface Props {
  state: PatientPlanState;
  patientId: string;
  viewerRole: 'DOCTOR' | 'THERAPIST' | 'SECRETARY' | 'ADMIN' | 'PATIENT';
}

/**
 * Treatment-plan tab content for the Patient File.
 *
 * Shows the active plan + any pending proposal stacked on top, and the
 * version history below. Doctor + Therapist get role-appropriate
 * action buttons via PlanCard; Secretary + Admin see a read-only view.
 *
 * The "New plan" CTA appears for Doctor only and only when no active
 * plan exists. The action layer enforces the same rule with
 * PLAN_ACTIVE_EXISTS.
 */
export async function PatientPlanTab({ state, patientId, viewerRole }: Props) {
  const t = await getTranslations('clinical.plans');
  const locale = await getLocale();
  const localeTag: 'en' | 'ar' = locale === 'ar' ? 'ar' : 'en';
  // Role-aware plan links (Prompt 37 item 3): only doctor + therapist own
  // plan routes. Admin/secretary used to get hardcoded /doctor/plans/… hrefs
  // that teleported them into the Doctor shell (the A-19 disease); for them
  // planHref returns null and titles render as plain text.
  const canCreatePlan = viewerRole === 'DOCTOR';

  return (
    <div className="space-y-4">
      {state.active ? null : canCreatePlan ? (
        <div className="flex items-center justify-between rounded-md border border-brand-border bg-brand-bg p-4">
          <p className="text-sm text-brand-textMuted">{t('noActivePlan')}</p>
          <Button asChild size="sm">
            <Link href={`/doctor/plans/new?patientId=${patientId}`}>
              <Plus className="me-1 size-4" />
              {t('newPlan')}
            </Link>
          </Button>
        </div>
      ) : (
        <p className="rounded-md border border-brand-border bg-brand-bg p-4 text-sm text-brand-textMuted">
          {t('noActivePlan')}
        </p>
      )}

      {state.proposal ? (
        <PlanCard plan={state.proposal} viewerRole={viewerRole} editHref={undefined} />
      ) : null}
      {state.active ? (
        <PlanCard
          plan={state.active}
          viewerRole={viewerRole}
          editHref={planEditHref(viewerRole, state.active.id) ?? undefined}
        />
      ) : null}

      {state.history.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-brand-navy">{t('history')}</h3>
          <ul className="divide-y divide-brand-border overflow-hidden rounded-md border border-brand-border bg-brand-surface text-sm">
            {state.history.map((h) => (
              <li key={h.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  {planHref(viewerRole, h.id) ? (
                    <Link
                      href={planHref(viewerRole, h.id) as `/${string}`}
                      className="font-medium text-brand-navy hover:underline"
                    >
                      {t('plan')} v{h.version}
                    </Link>
                  ) : (
                    <span className="font-medium text-brand-navy">
                      {t('plan')} v{h.version}
                    </span>
                  )}
                  <span className="text-xs text-brand-textMuted">{h.status}</span>
                </div>
                <div className="mt-1 text-xs text-brand-textMuted">
                  {formatShortDate(h.createdAt, localeTag)}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
