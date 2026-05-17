import { getTranslations, setRequestLocale } from 'next-intl/server';

import { auth } from '@/auth';
import { ROLE_HOME } from '@/lib/auth/routes';
import { redirect } from '@/i18n/navigation';

import { ChangePasswordForm } from './_components/ChangePasswordForm';

export default async function ChangePasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await auth();
  if (!session?.user) {
    redirect({ href: '/login', locale });
  }
  const t = await getTranslations('auth');
  const home = session ? ROLE_HOME[session.user.role] : '/login';

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-medium text-brand-navy">{t('changePasswordTitle')}</h1>
        <p className="mt-2 text-sm text-brand-textMuted">{t('changePasswordDescription')}</p>
      </div>
      <ChangePasswordForm successHref={home} forced={session?.user.mustChangePassword ?? false} />
    </div>
  );
}
