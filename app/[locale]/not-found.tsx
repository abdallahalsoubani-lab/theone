import { getTranslations } from 'next-intl/server';

import { Logo } from '@/components/brand/Logo';
import { Link } from '@/i18n/navigation';

export default async function LocaleNotFound() {
  const t = await getTranslations('errors.notFound');

  return (
    <section className="mx-auto flex max-w-xl flex-col items-center gap-6 px-6 py-24 text-center">
      <Logo size={64} />
      <div className="space-y-3">
        <h1 className="text-3xl font-medium text-brand-navy">{t('title')}</h1>
        <p className="text-brand-textMuted">{t('description')}</p>
      </div>
      <Link
        href="/"
        className="inline-flex items-center rounded-md bg-gradient-cta px-6 py-3 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90"
      >
        {t('cta')}
      </Link>
    </section>
  );
}
