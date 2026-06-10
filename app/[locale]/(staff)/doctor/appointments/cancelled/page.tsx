import { CancelledAppointmentsContent } from '@/components/appointments/CancelledAppointmentsContent';

export default async function DoctorCancelledAppointmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  return <CancelledAppointmentsContent locale={locale} searchParams={await searchParams} />;
}
