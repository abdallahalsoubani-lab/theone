import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';

import { ForgotPasswordForm } from './_components/ForgotPasswordForm';

export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('auth');

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-medium text-brand-navy">{t('forgotPasswordTitle')}</h1>
        <p className="mt-2 text-sm text-brand-textMuted">{t('forgotPasswordDescription')}</p>
      </div>
      <ForgotPasswordForm />
      <div className="text-center text-sm">
        <Link href="/login" className="text-brand-cyan underline-offset-4 hover:underline">
          {t('back')}
        </Link>
      </div>
    </div>
  );
}
