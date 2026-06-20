import { Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { formatDate } from '@/lib/format/date';
import type { IntakeListRow } from '@/lib/intake/queries';

interface Props {
  patientId: string;
  rows: IntakeListRow[];
  basePath: string;
  canCreate: boolean;
}

const STATUS_VARIANT: Record<string, 'teal' | 'cyan' | 'muted'> = {
  COMPLETED: 'teal',
  REVIEWED: 'cyan',
  IN_PROGRESS: 'muted',
};

/**
 * Intake assessments tab on the patient file. Every assessment is a read-only
 * View link preserving the historical record. (Editing a submitted assessment
 * is not an implemented workflow — there is no update service/action/form — so
 * no Edit affordance is offered; a correction is captured by adding a new
 * assessment.)
 */
export function PatientIntakeTab({ patientId, rows, basePath, canCreate }: Props) {
  const t = useTranslations('intake');
  const locale = useLocale();
  const intlLocale: 'en' | 'ar' = locale === 'ar' ? 'ar' : 'en';

  return (
    <div className="space-y-4">
      {canCreate ? (
        <div className="flex justify-end">
          <Button asChild>
            <Link href={`${basePath}/${patientId}/intake/new`}>
              <Plus className="me-2 size-4" />
              {t('addIntake')}
            </Link>
          </Button>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-brand-textMuted">
            {t('noIntakes')}
          </CardContent>
        </Card>
      ) : (
        <ul className="divide-y divide-brand-border overflow-hidden rounded-md border border-brand-border bg-brand-surface">
          {rows.map((r) => {
            const filledBy = r.assessedBy
              ? locale === 'ar'
                ? r.assessedBy.fullNameAr
                : r.assessedBy.fullNameEn
              : '—';
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-3 p-3">
                <Badge variant={r.type === 'ADULT' ? 'cyan' : 'teal'}>
                  {r.type === 'ADULT' ? t('typeAdult') : t('typePediatric')}
                </Badge>
                <div className="flex-1">
                  <p className="text-sm font-medium text-brand-navy">
                    {formatDate(r.assessedAt, intlLocale)}
                  </p>
                  <p className="text-xs text-brand-textMuted">
                    {t('filledBy', { name: filledBy })}
                  </p>
                </div>
                <Badge variant={STATUS_VARIANT[r.status] ?? 'muted'}>
                  {t(
                    `status${r.status === 'IN_PROGRESS' ? 'InProgress' : r.status === 'COMPLETED' ? 'Completed' : 'Reviewed'}`,
                  )}
                </Badge>
                <div className="flex gap-2">
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`${basePath}/${patientId}/intake/${r.id}`}>{t('view')}</Link>
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
