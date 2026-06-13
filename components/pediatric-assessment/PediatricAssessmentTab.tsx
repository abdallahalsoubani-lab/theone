'use client';

import { Pencil, Plus, Settings2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { ExportPediatricAssessmentButton } from '@/components/exports/ExportPediatricAssessmentButton';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import type { AssessmentListRow } from '@/lib/pediatric-assessment/queries';

interface Props {
  rows: AssessmentListRow[];
  canEdit: boolean;
  /** Role route base, e.g. "/doctor/patients/{id}". New/edit live under it. */
  basePath: string;
  /** Manage-custom-fields href (only for canEdit). */
  manageFieldsHref: string | null;
  locale: 'en' | 'ar';
}

export function PediatricAssessmentTab({
  rows,
  canEdit,
  basePath,
  manageFieldsHref,
  locale,
}: Props) {
  const t = useTranslations('pediatricAssessment');
  const ar = locale === 'ar';

  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(ar ? 'ar-JO' : 'en-GB', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-brand-textMuted">{t('subtitle')}</p>
        {canEdit ? (
          <div className="flex gap-2">
            {manageFieldsHref ? (
              <Link href={manageFieldsHref as `/${string}`}>
                <Button type="button" variant="outline" size="sm">
                  <Settings2 className="size-4" /> {t('manageFields')}
                </Button>
              </Link>
            ) : null}
            <Link href={`${basePath}/pediatric-assessment/new` as `/${string}`}>
              <Button type="button" size="sm">
                <Plus className="size-4" /> {t('newAssessment')}
              </Button>
            </Link>
          </div>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-brand-border bg-brand-bg p-8 text-center text-sm text-brand-textMuted">
          {t('empty')}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-border bg-brand-surface p-3"
            >
              <div>
                <p className="flex items-center gap-2 font-medium text-brand-navy">
                  {r.assessmentDate ? fmt(r.assessmentDate) : fmt(r.createdAt)}
                  {r.edited ? (
                    <span className="rounded-full bg-brand-bg px-2 py-0.5 text-[11px] text-brand-textMuted">
                      {t('edited')}
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-brand-textMuted">
                  {t('byLine', { name: ar ? r.createdByNameAr : r.createdByNameEn })}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ExportPediatricAssessmentButton assessmentId={r.id} locale={locale} />
                {canEdit ? (
                  <Link href={`${basePath}/pediatric-assessment/${r.id}/edit` as `/${string}`}>
                    <Button type="button" variant="outline" size="sm">
                      <Pencil className="size-4" /> {t('edit')}
                    </Button>
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
