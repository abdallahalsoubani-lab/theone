import { getTranslations } from 'next-intl/server';

import { db } from '@/lib/db';
import { getEffectiveSession } from '@/lib/impersonation/session';
import { getClinicianSummary } from '@/lib/reports/clinicianSummary';
import { buildClinicianSummaryCsv } from '@/lib/reports/csv';
import { resolveReportRange } from '@/lib/reports/params';
import { can } from '@/lib/rbac/can';

/**
 * Clinician summary CSV export (Prompt 40 §3.4). Same permission as the page
 * (`reports.clinician_summary` — ADMIN + DOCTOR), same range resolver as the
 * page so the file always matches the screen, localized headers per the
 * `locale` param, and a UTF-8 BOM so Excel decodes Arabic — the audit-export
 * convention (Prompt 15).
 */
export async function GET(request: Request): Promise<Response> {
  const session = await getEffectiveSession();
  if (!session?.user || !can(session.user, 'reports.clinician_summary')) {
    return new Response('Forbidden', { status: 403 });
  }

  const url = new URL(request.url);
  const locale = url.searchParams.get('locale') === 'ar' ? 'ar' : 'en';
  const settings = await db.clinicSettings.findUnique({
    where: { id: 'default' },
    select: { timezone: true },
  });
  const range = resolveReportRange(
    {
      scope: url.searchParams.get('scope') ?? undefined,
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
    },
    new Date(),
    settings?.timezone ?? undefined,
  );

  const summary = await getClinicianSummary({ start: range.start, end: range.end });
  const t = await getTranslations({ locale, namespace: 'reports.clinicianSummary' });
  const csv = buildClinicianSummaryCsv(
    summary,
    {
      clinician: t('colClinician'),
      role: t('colRole'),
      completed: t('colCompleted'),
      booked: t('colBooked'),
      cancelled: t('colCancelled'),
      noShow: t('colNoShow'),
      totalsRow: t('totalsRow'),
    },
    locale,
  );

  // Explicit BOM (audit-export convention) — Excel needs it to decode Arabic.
  return new Response('\uFEFF' + csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="clinician-summary_${range.fromKey}_${range.toKey}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
