import { AuditAction } from '@prisma/client';
import { getTranslations } from 'next-intl/server';

import { withAudit } from '@/lib/audit/withAudit';
import { getEffectiveSession } from '@/lib/impersonation/session';
import { buildPatientsRosterCsv, listPatientsForExport } from '@/lib/patients/export';
import { can } from '@/lib/rbac/can';

/**
 * One-click patients roster CSV (Prompt 55 §4). Gated on `patients.export`
 * (Secretary + Admin only — the roster carries contact PII, so the P15
 * phone boundary is enforced at the endpoint, not the UI). Localized headers
 * per the `locale` param and a UTF-8 BOM so Excel decodes Arabic — the
 * audit-export convention. The export itself is audited (who, when, row
 * count) as READ_SENSITIVE.
 */

const recordExport = withAudit<
  [{ rowCount: number }],
  { event: 'PATIENTS_EXPORTED'; rowCount: number }
>(
  {
    entityType: 'Patient',
    action: AuditAction.READ_SENSITIVE,
    extractEntityId: () => 'export',
    extractAfter: (result) => result,
  },
  async ({ rowCount }) => ({ event: 'PATIENTS_EXPORTED' as const, rowCount }),
);

export async function GET(request: Request): Promise<Response> {
  const session = await getEffectiveSession();
  if (!session?.user || !can(session.user, 'patients.export')) {
    return new Response('Forbidden', { status: 403 });
  }

  const url = new URL(request.url);
  const locale = url.searchParams.get('locale') === 'ar' ? 'ar' : 'en';

  const rows = await listPatientsForExport();
  const t = await getTranslations({ locale, namespace: 'patients.export' });
  const csv = buildPatientsRosterCsv(rows, {
    header: {
      name: t('colName'),
      gender: t('colGender'),
      dob: t('colDob'),
      age: t('colAge'),
      phone: t('colPhone'),
      address: t('colAddress'),
      occupation: t('colOccupation'),
      createdAt: t('colCreatedAt'),
      firstVisit: t('colFirstVisit'),
    },
    gender: { MALE: t('genderMale'), FEMALE: t('genderFemale') },
    firstVisitPending: t('firstVisitPending'),
    firstVisitDone: t('firstVisitDone'),
  });

  await recordExport({ rowCount: rows.length }).catch((err: unknown) => {
    console.error('[patients.export] audit write failed', err);
  });

  // Explicit BOM (audit-export convention) — Excel needs it to decode Arabic.
  return new Response('\uFEFF' + csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="patients-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
