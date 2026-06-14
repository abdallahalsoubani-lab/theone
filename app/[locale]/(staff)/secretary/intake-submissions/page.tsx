import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { formatDateTime } from '@/lib/format/date';
import { listPendingSubmissions } from '@/lib/intake-submissions/queries';
import { requirePermission } from '@/lib/rbac/guards';

/**
 * Secretary review queue (Prompt 23 §4) — pending public intake submissions.
 * Dedicated surface next to the inbox; SECRETARY + ADMIN only.
 */
export default async function IntakeSubmissionsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('intake_submission.read');
  const intlLocale: 'en' | 'ar' = locale === 'ar' ? 'ar' : 'en';

  const [t, rows] = await Promise.all([
    getTranslations('intakeSubmissions'),
    listPendingSubmissions(),
  ]);

  return (
    <section className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-navy">{t('title')}</h1>
        <p className="text-sm text-brand-textMuted">{t('subtitle')}</p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-brand-border bg-brand-bg p-12 text-center text-sm text-brand-textMuted">
          {t('empty')}
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center gap-4 p-4">
                  <Badge variant={r.type === 'ADULT' ? 'default' : 'outline'}>
                    {r.type === 'ADULT' ? t('typeAdult') : t('typeChild')}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-brand-navy">
                      {r.submittedName}
                    </p>
                    <p className="text-xs text-brand-textMuted">
                      {r.submittedPhone} · {formatDateTime(r.createdAt, intlLocale)}
                    </p>
                  </div>
                  <Button asChild size="sm">
                    <Link href={`/secretary/intake-submissions/${r.id}`}>{t('review')}</Link>
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
