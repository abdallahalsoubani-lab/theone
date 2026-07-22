import { CalendarPageContent } from '@/components/calendar/CalendarPageContent';

/**
 * Admin calendar (Prompt 15 §2A). The backend already authorized Admin for
 * appointment mutations; this gives Admin the same interactive board —
 * including the now-wired drag-to-reschedule — that the Secretary has.
 */
export default async function AdminCalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  return (
    <CalendarPageContent
      locale={locale}
      autoBook={
        sp.bookPatient ? { patientId: sp.bookPatient, doctorsOnly: sp.doctors === '1' } : undefined
      }
    />
  );
}
