import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';

/**
 * Stand-alone OTP entry page. The primary flow is the inline two-step on
 * `/login` (Patient tab); this route exists so deep-links from notifications
 * have a valid landing. For now it simply directs the user back to /login
 * where the inline form holds state — Prompt 5 (admin) may add a dedicated
 * SSO/OTP-only flow on top of this scaffolding.
 */
export default async function OtpVerifyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('auth');
  return (
    <div className="space-y-6 text-center">
      <h1 className="text-2xl font-medium text-brand-navy">{t('otpLabel')}</h1>
      <p className="text-sm text-brand-textMuted">{t('subtitle')}</p>
      <Link
        href="/login"
        className="inline-flex items-center rounded-md bg-gradient-cta px-6 py-3 text-sm font-medium text-white shadow-sm hover:opacity-90"
      >
        {t('signIn')}
      </Link>
    </div>
  );
}
