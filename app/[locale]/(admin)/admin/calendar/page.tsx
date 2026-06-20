import { CalendarPageContent } from '@/components/calendar/CalendarPageContent';

/**
 * Admin calendar (Prompt 15 §2A). The backend already authorized Admin for
 * appointment mutations; this gives Admin the same interactive board —
 * including the now-wired drag-to-reschedule — that the Secretary has.
 */
export default async function AdminCalendarPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <CalendarPageContent locale={locale} />;
}
