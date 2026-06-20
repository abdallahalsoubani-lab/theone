import { CalendarPageContent } from '@/components/calendar/CalendarPageContent';

/**
 * Secretary's primary working view. The interactive board (and its data
 * window) lives in the shared CalendarPageContent so Admin and Doctor reuse
 * the identical calendar (Prompt 15 §2).
 */
export default async function SecretaryCalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ calendar?: string | string[] }>;
}) {
  const { locale } = await params;
  const { calendar } = await searchParams;
  return <CalendarPageContent locale={locale} calendarParam={calendar} />;
}
