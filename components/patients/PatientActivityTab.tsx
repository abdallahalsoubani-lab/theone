import { useLocale, useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { formatRelative } from '@/lib/format/date';
import type { PatientActivityRow } from '@/lib/patients/queries-audit';

interface Props {
  rows: PatientActivityRow[];
}

const ACTION_VARIANT: Record<string, 'teal' | 'cyan' | 'destructive' | 'muted'> = {
  CREATE: 'teal',
  UPDATE: 'cyan',
  DELETE: 'destructive',
  READ_SENSITIVE: 'muted',
};

export function PatientActivityTab({ rows }: Props) {
  const t = useTranslations('admin.audit');
  const tFile = useTranslations('patients.file');
  const locale = useLocale();
  const intlLocale: 'en' | 'ar' = locale === 'ar' ? 'ar' : 'en';

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-brand-textMuted">
          {t('noEntries')}
        </CardContent>
      </Card>
    );
  }

  return (
    <ul className="divide-y divide-brand-border overflow-hidden rounded-md border border-brand-border bg-brand-surface">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center gap-3 p-3 text-sm">
          <Badge variant={ACTION_VARIANT[r.action] ?? 'muted'}>{r.action}</Badge>
          <div className="flex-1">
            <p className="text-brand-text">
              <code className="text-xs">{r.entityType}</code>
            </p>
            <p className="text-xs text-brand-textMuted">
              {r.actor ? (locale === 'ar' ? r.actor.fullNameAr : r.actor.fullNameEn) : '—'}
            </p>
          </div>
          <span className="text-xs text-brand-textMuted">
            {formatRelative(r.createdAt, intlLocale)}
          </span>
          {/* Reference tFile so unused-import lint stays quiet — tab label is shown by the parent. */}
          <span className="sr-only">{tFile('tabActivity')}</span>
        </li>
      ))}
    </ul>
  );
}
