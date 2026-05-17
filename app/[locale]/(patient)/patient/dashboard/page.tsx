import { Calendar, Home, User } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

export default async function PatientDashboard({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login`);
  if (session.user.role !== 'PATIENT') redirect(`/${locale}/`);
  const t = await getTranslations('patient.portal');
  const name = locale === 'ar' ? session.user.fullNameAr : session.user.fullNameEn;

  return (
    <section className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-medium text-brand-navy">{t('dashboardTitle', { name })}</h1>
      </header>

      <Card>
        <CardContent className="space-y-2 p-6">
          <div className="flex items-center gap-2 text-sm font-medium text-brand-navy">
            <Calendar className="size-4 text-brand-cyan" />
            {t('nextAppointmentTitle')}
          </div>
          <p className="text-sm text-brand-textMuted">{t('nextAppointmentPlaceholder')}</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-6">
          <div className="flex items-center gap-2 text-sm font-medium text-brand-navy">
            <Home className="size-4 text-brand-cyan" />
            {t('homeProgramTitle')}
          </div>
          <p className="text-sm text-brand-textMuted">{t('homeProgramPlaceholder')}</p>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button asChild variant="outline">
          <Link href="/patient/profile">
            <User className="me-2 size-4" />
            {t('profileTitle')}
          </Link>
        </Button>
      </div>
    </section>
  );
}
