import { getTranslations, setRequestLocale } from 'next-intl/server';

import { CancelledAppointmentsTable } from '@/components/appointments/CancelledAppointmentsTable';
import { listActiveClinicians, listCancelledAppointments } from '@/lib/appointments/queries';
import { requirePermission } from '@/lib/rbac/guards';
import { customRange } from '@/lib/reports/range';
import { clinicDateKey } from '@/lib/time/clinic';
import { getClinicTimeZone } from '@/lib/time/clinic-server';

const DAY_MS = 86_400_000;
const PAGE_SIZE = 20;

/**
 * Cancelled-appointments view body (Prompt 17), shared by the Secretary/Admin
 * and Doctor routes. Default range: cancellations in the last 30 days, newest
 * first. Phone is hidden from Doctor viewers (Prompt 15 §1).
 */
export async function CancelledAppointmentsContent({
  locale,
  searchParams,
}: {
  locale: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  setRequestLocale(locale);
  // Chain the effective user from requirePermission so the phone-visibility
  // gate matches the role RBAC enforces — also during Act-As (Prompt 22 §3.2).
  const viewer = await requirePermission('appointments.read');
  const t = await getTranslations('appointments.cancelledView');

  const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
  const fromStr = str(searchParams.from);
  const toStr = str(searchParams.to);
  const therapistId = str(searchParams.therapist);
  const search = str(searchParams.q);
  const page = Math.max(1, parseInt(str(searchParams.page) ?? '1', 10) || 1);

  // Default: last 30 days. The typed dates are CLINIC calendar days — `from` is
  // that day's opening midnight in Amman and `to` is inclusive, so the bound is
  // the last instant before the following clinic midnight. (Parsing them as
  // UTC midnight shifted every edge by the Amman offset.)
  const timeZone = await getClinicTimeZone();
  const defaultFrom = clinicDateKey(new Date(Date.now() - 30 * DAY_MS), timeZone);
  const range = customRange(fromStr ?? defaultFrom, toStr ?? fromStr ?? defaultFrom, timeZone);
  const fromDate = range?.start;
  const toDate = toStr && range ? new Date(range.end.getTime() - 1) : undefined;

  const canSeePhone = viewer.role === 'SECRETARY' || viewer.role === 'ADMIN';

  const [data, clinicians] = await Promise.all([
    listCancelledAppointments({
      filters: { from: fromDate, to: toDate, therapistId, search, page, pageSize: PAGE_SIZE },
      canSeePhone,
    }),
    listActiveClinicians(),
  ]);

  return (
    <section className="space-y-4 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-medium text-brand-navy">{t('title')}</h1>
        <p className="mt-1 text-sm text-brand-textMuted">{t('subtitle')}</p>
      </header>
      <CancelledAppointmentsTable
        rows={data.rows}
        total={data.total}
        page={page}
        pageSize={PAGE_SIZE}
        initialSearch={search ?? ''}
        therapistOptions={clinicians.map((c) => ({
          id: c.id,
          fullNameEn: c.fullNameEn,
          fullNameAr: c.fullNameAr,
        }))}
        filterFrom={fromStr ?? defaultFrom}
        filterTo={toStr ?? ''}
        filterTherapistId={therapistId ?? ''}
      />
    </section>
  );
}
