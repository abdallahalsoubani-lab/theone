import { getTranslations, setRequestLocale } from 'next-intl/server';

import { auth } from '@/auth';
import { CancelledAppointmentsTable } from '@/components/appointments/CancelledAppointmentsTable';
import { listActiveClinicians, listCancelledAppointments } from '@/lib/appointments/queries';
import { requirePermission } from '@/lib/rbac/guards';

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
  await requirePermission('appointments.read');
  const session = await auth();
  const t = await getTranslations('appointments.cancelledView');

  const str = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
  const fromStr = str(searchParams.from);
  const toStr = str(searchParams.to);
  const therapistId = str(searchParams.therapist);
  const search = str(searchParams.q);
  const page = Math.max(1, parseInt(str(searchParams.page) ?? '1', 10) || 1);

  // Default: last 30 days. `from` is start-of-day; `to` (if given) end-of-day.
  const defaultFrom = new Date(Date.now() - 30 * DAY_MS);
  const fromDate = new Date(`${fromStr ?? defaultFrom.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const toDate = toStr ? new Date(`${toStr}T23:59:59.999Z`) : undefined;

  const canSeePhone = session?.user?.role === 'SECRETARY' || session?.user?.role === 'ADMIN';

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
        filterFrom={fromStr ?? defaultFrom.toISOString().slice(0, 10)}
        filterTo={toStr ?? ''}
        filterTherapistId={therapistId ?? ''}
      />
    </section>
  );
}
