import { setRequestLocale } from 'next-intl/server';

import { ScheduleGrantsBoard } from '@/components/schedule-grants/ScheduleGrantsBoard';
import { listActiveClinicians } from '@/lib/appointments/queries';
import { requirePermission } from '@/lib/rbac/guards';
import { listScheduleGrants } from '@/lib/schedule-grants/queries';

/** P64 #4 — who may see whose calendar (read-only). Admin + Secretary. */
export default async function ScheduleAccessPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('schedule_grants.manage');
  const [grants, clinicians] = await Promise.all([listScheduleGrants(), listActiveClinicians()]);
  return <ScheduleGrantsBoard grants={grants} clinicians={clinicians} />;
}
