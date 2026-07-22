import { CalendarPageContent } from '@/components/calendar/CalendarPageContent';

/**
 * Doctor's calendar — full scheduling parity with the Secretary (Prompt 15
 * §2B). Reuses the shared board; `requirePermission('appointments.read')`
 * inside it passes now that DOCTOR holds the appointment permission set.
 */
export default async function DoctorCalendarPage({
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
