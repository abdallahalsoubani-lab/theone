import { CalendarPageContent } from '@/components/calendar/CalendarPageContent';

/**
 * Secretary's primary working view. The interactive board (and its data
 * window) lives in the shared CalendarPageContent so Admin and Doctor reuse
 * the identical calendar (Prompt 15 §2).
 */
export default async function SecretaryCalendarPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <CalendarPageContent locale={locale} />;
}
