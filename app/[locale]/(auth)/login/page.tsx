import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

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

      {/*
       * Prompt 11 §4.4: no self-service password reset in v1. Admins
       * issue temp passwords via /admin/users (Prompt 5). The OTP tab
       * above remains the password-free fallback for any phone-bound
       * account.
       */}
      <p className="text-center text-xs text-brand-textMuted">{t('login.forgotPasswordHint')}</p>
    </div>
  );
}
