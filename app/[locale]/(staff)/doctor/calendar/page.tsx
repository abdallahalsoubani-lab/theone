import { CalendarPageContent } from '@/components/calendar/CalendarPageContent';

/**
 * Doctor's calendar — VIEW-ONLY since Prompt 45 row 3 (reverses the Prompt 15
 * §2B scheduling parity). Reuses the shared board, which derives the
 * read-only mode from the Doctor's narrowed RBAC; the full clinic schedule
 * stays visible. The `?bookPatient` booking deep-link (Prompt 41) is no
 * longer honored here — a doctor cannot book.
 */
export default async function DoctorCalendarPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <CalendarPageContent locale={locale} />;
}
