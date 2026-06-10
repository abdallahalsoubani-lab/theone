import { setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { PatientHomeProgramView } from '@/components/home-program/PatientHomeProgramView';
import { getVisibleHomeProgram, getVisibleTodayItems } from '@/lib/clinical/home-program/approval';
import { calculateStreak } from '@/lib/clinical/compliance/calculate';
import { db } from '@/lib/db';
import { requirePermission } from '@/lib/rbac/guards';

export default async function PatientHomeProgramPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('home_program.read.own', {});
  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login`);
  const patientId = session.user.id;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // Patient sees APPROVED content only (Prompt 16) — getVisible* returns the
  // live items when approved, else the last approved snapshot, else nothing.
  const [todayItems, fullProgram, todayCompletionRows, streak] = await Promise.all([
    getVisibleTodayItems(patientId, today),
    getVisibleHomeProgram(patientId),
    db.homeProgramCompletion.findMany({
      where: {
        item: { patientId },
        scheduledDate: today,
      },
      select: { itemId: true, completedAt: true },
    }),
    calculateStreak({ patientId, now: today }),
  ]);

  const todayCompletions = new Map<string, Date | null>();
  for (const r of todayCompletionRows) {
    todayCompletions.set(r.itemId, r.completedAt ?? null);
  }

  return (
    <PatientHomeProgramView
      todayItems={todayItems}
      fullProgram={fullProgram}
      todayCompletions={todayCompletions}
      streak={streak}
      locale={locale === 'ar' ? 'ar' : 'en'}
    />
  );
}
