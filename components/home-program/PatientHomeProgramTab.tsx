import { Pencil } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { ComplianceWidget } from '@/components/home-program/ComplianceWidget';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import type { ComplianceResult } from '@/lib/clinical/compliance/calculate';
import type { HomeProgramItemRow } from '@/lib/clinical/home-program/queries';

interface Props {
  patientId: string;
  items: HomeProgramItemRow[];
  sevenDay: ComplianceResult;
  thirtyDay: ComplianceResult;
  streak: number;
  /** Last-completed timestamp per item (within the 30-day window). */
  lastCompletedById: Map<string, Date>;
  /** True when the viewer is the patient's assigned therapist (or Doctor/Admin). */
  canEdit: boolean;
  locale: 'en' | 'ar';
}

const DAY_LABELS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LABELS_AR = ['أحد', 'إثن', 'ثلا', 'أرب', 'خمي', 'جمع', 'سبت'];

/**
 * Patient-file Home Program tab (clinician-facing, read-mostly).
 * Compliance stats up top, per-item breakdown below with Edit link to
 * the builder.
 */
export async function PatientHomeProgramTab({
  patientId,
  items,
  sevenDay,
  thirtyDay,
  streak,
  lastCompletedById,
  canEdit,
  locale,
}: Props) {
  const t = await getTranslations('clinical.compliance');
  const tHp = await getTranslations('clinical.homeProgram');
  const dayLabels = locale === 'ar' ? DAY_LABELS_AR : DAY_LABELS_EN;
  const localeTag = locale === 'ar' ? 'ar' : 'en';

  return (
    <div className="space-y-4">
      <ComplianceWidget sevenDay={sevenDay} thirtyDay={thirtyDay} streak={streak} />

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-brand-navy">{tHp('currentProgram')}</h3>
          {canEdit ? (
            <Button asChild size="sm" variant="outline">
              <Link href={`/therapist/patients/${patientId}/home-program/edit`}>
                <Pencil className="me-1 size-4" />
                {tHp('edit')}
              </Link>
            </Button>
          ) : null}
        </div>
        {items.length === 0 ? (
          <p className="rounded-md border border-brand-border bg-brand-bg p-4 text-sm text-brand-textMuted">
            {tHp('emptyBuilder')}
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
                      {t('lastCompleted')}: {last ? last.toLocaleDateString(localeTag) : '—'}
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
