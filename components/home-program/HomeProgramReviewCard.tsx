'use client';

import { useLocale, useTranslations } from 'next-intl';
import { patientDisplayName } from '@/lib/format/patientName';

import { HomeProgramReviewActions } from '@/components/home-program/HomeProgramReviewActions';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import type { PendingApprovalRow } from '@/lib/clinical/home-program/approval';
import { bidiIsolate } from '@/lib/format/bidi';

/**
 * One row of the doctor's approval queue. Quick approve / return live here for
 * the obvious cases; "Review program" opens the full review page where the
 * doctor reads every exercise, edits, and decides — the same actions, same
 * rules (PT-B2 item 3).
 */
export function HomeProgramReviewCard({ row }: { row: PendingApprovalRow }) {
  const t = useTranslations('clinical.homeProgram.approval');
  const locale = useLocale();

  const patientName = patientDisplayName(row.patientFullNameEn, row.patientFullNameAr);
  const therapistName =
    (locale === 'ar' ? row.therapistFullNameAr : row.therapistFullNameEn) ?? '—';

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-brand-navy">{patientName}</p>
            <p className="text-xs text-brand-textMuted">
              {/* The name lives inside the ICU message — isolate it so an AR
                  label + Latin name renders in order (QA 6.5). */}
              {t('submittedBy', { name: bidiIsolate(therapistName) })} ·{' '}
              {t('itemCount', { count: row.itemCount })}
            </p>
          </div>
          <Link
            href={`/doctor/patients/${row.patientId}/home-program/edit` as `/${string}`}
            className="text-xs text-brand-cyan hover:underline"
          >
            {t('reviewLink')}
          </Link>
        </div>

        <HomeProgramReviewActions patientId={row.patientId} />
      </CardContent>
    </Card>
  );
}
