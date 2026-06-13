import { getTranslations, setRequestLocale } from 'next-intl/server';

import { auth } from '@/auth';
import { WaitlistPanel } from '@/components/waitlist/WaitlistPanel';
import { listActiveClinicians, listActivePatientsBrief } from '@/lib/appointments/queries';
import { db } from '@/lib/db';
import { viewerCanSeePatientPhone } from '@/lib/patients/access';
import { can } from '@/lib/rbac/can';
import { requirePermission } from '@/lib/rbac/guards';
import { listWaitlistEntries } from '@/lib/waitlist/queries';
import { waitlistStatusFilterSchema } from '@/lib/waitlist/schemas';

/**
 * Booking-waitlist management (Prompt 19 §3). Today + upcoming entries with a
 * status filter, add + remove, and one-click placement into a freed slot.
 * Secretary / Admin manage; Doctor reads (and never sees patient phone).
 */
export const dynamic = 'force-dynamic';

export default async function WaitlistPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  await requirePermission('waitlist.read');
  const session = await auth();
  const t = await getTranslations('waitlist');

  const statusFilter = waitlistStatusFilterSchema.catch('WAITING').parse(sp.status);
  const canSeePhone = await viewerCanSeePatientPhone();
  const canManage = session?.user ? can(session.user, 'waitlist.create') : false;
  const canPlace = session?.user ? can(session.user, 'waitlist.place') : false;
  const canOverride = session?.user ? can(session.user, 'appointments.override_conflict') : false;

  const [entries, patients, clinicians, rooms, settings] = await Promise.all([
    listWaitlistEntries({ canSeePhone, statusFilter }),
    listActivePatientsBrief(),
    listActiveClinicians(),
    db.room.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    db.clinicSettings.findUnique({
      where: { id: 'default' },
      select: { defaultAppointmentDuration: true },
    }),
  ]);

  return (
    <section className="space-y-4 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-medium text-brand-navy">{t('title')}</h1>
        <p className="mt-1 text-sm text-brand-textMuted">{t('subtitle')}</p>
      </header>
      <WaitlistPanel
        entries={entries}
        statusFilter={statusFilter}
        patients={patients}
        clinicians={clinicians}
        rooms={rooms}
        defaultDurationMinutes={settings?.defaultAppointmentDuration ?? 30}
        canManage={canManage}
        canPlace={canPlace}
        canOverride={canOverride}
        locale={locale}
      />
    </section>
  );
}
