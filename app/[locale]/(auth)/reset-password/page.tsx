import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';

import { ResetPasswordForm } from './_components/ResetPasswordForm';

export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { locale } = await params;
  const { token = '' } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations('auth');

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-medium text-brand-navy">{t('resetPasswordTitle')}</h1>
        <p className="mt-2 text-sm text-brand-textMuted">{t('resetPasswordDescription')}</p>
      </div>
      <ResetPasswordForm token={token} />
      <div className="text-center text-sm">
        <Link href="/login" className="text-brand-cyan underline-offset-4 hover:underline">
          {t('back')}
        </Link>
      </div>
    </div>
  );
}
