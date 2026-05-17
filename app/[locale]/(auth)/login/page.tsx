import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Link } from '@/i18n/navigation';

import { PatientLoginForm } from './_components/PatientLoginForm';
import { StaffLoginForm } from './_components/StaffLoginForm';

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('auth');

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-medium text-brand-navy">{t('title')}</h1>
        <p className="mt-2 text-sm text-brand-textMuted">{t('subtitle')}</p>
      </div>

      <Tabs defaultValue="staff" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="staff">{t('staffTab')}</TabsTrigger>
          <TabsTrigger value="patient">{t('patientTab')}</TabsTrigger>
        </TabsList>
        <TabsContent value="staff">
          <StaffLoginForm />
        </TabsContent>
        <TabsContent value="patient">
          <PatientLoginForm />
        </TabsContent>
      </Tabs>

      <div className="text-center text-sm">
        <Link
          href="/forgot-password"
          className="text-brand-cyan underline-offset-4 hover:underline"
        >
          {t('forgotPassword')}
        </Link>
      </div>
    </div>
  );
}
