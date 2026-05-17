import { Link } from '@/i18n/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Logo } from '@/components/brand/Logo';

/**
 * Foundation landing page.
 *
 * Replaces the Prompt 1 hardcoded-English placeholder. All copy now flows
 * through next-intl; the shell (Header / Footer) is mounted by the locale
 * layout, so this page only renders its own content.
 */
export default async function LocaleHomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('landing');

  return (
    <section className="mx-auto flex max-w-3xl flex-col items-center justify-center gap-8 px-6 py-20 text-center">
      <Logo size={96} />
      <div className="space-y-3">
        <h1 className="text-4xl font-medium text-brand-navy">{t('title')}</h1>
        <p className="text-brand-textMuted">{t('subtitle')}</p>
      </div>
      <p className="rounded-md border border-brand-border bg-brand-surface px-4 py-2 text-sm text-brand-textMuted">
        {t('currentLocale', { locale })}
      </p>
      <Link
        href="/style-guide"
        className="inline-flex items-center rounded-md bg-gradient-cta px-6 py-3 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90"
      >
        {t('viewStyleGuide')}
      </Link>
    </section>
  );
}
