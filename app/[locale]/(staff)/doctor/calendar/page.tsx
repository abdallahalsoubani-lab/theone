import { CalendarPageContent } from '@/components/calendar/CalendarPageContent';

/**
 * Doctor's calendar — full scheduling parity with the Secretary (Prompt 15
 * §2B). Reuses the shared board; `requirePermission('appointments.read')`
 * inside it passes now that DOCTOR holds the appointment permission set.
 */
export default async function DoctorCalendarPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <CalendarPageContent locale={locale} />;
}
