import { getTranslations } from 'next-intl/server';

import { Logo } from '@/components/brand/Logo';
import { Link } from '@/i18n/navigation';

import { LanguageToggle } from './LanguageToggle';

/**
 * Site footer (Prompt 3 §4.6).
 *
 * Three columns on desktop, one column stack on mobile. Mirrors automatically
 * under RTL because the grid columns are direction-agnostic and every margin
 * is logical (ms-/me-/start-/end-). Locale toggle is echoed here so it stays
 * reachable on mobile when the header collapses behind the drawer.
 */
export async function Footer() {
  const t = await getTranslations('footer');
  const year = new Date().getFullYear();
  const clinicName = t('clinicNameEn');

  return (
    <footer
      className="border-t border-brand-border bg-brand-bg px-4 py-12 text-sm text-brand-textMuted sm:px-6"
      aria-label={clinicName}
    >
      <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-3">
        <div className="space-y-3">
          <Logo size={40} />
          <p className="font-medium text-brand-navy">{clinicName}</p>
          <p className="font-arabic text-brand-navy" dir="rtl">
            {t('clinicNameAr')}
          </p>
          <p>{t('tagline')}</p>
        </div>

        <nav aria-label={t('linksHeading')} className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-wider text-brand-navy">
            {t('linksHeading')}
          </h2>
          <ul className="space-y-2">
            <li>
              <Link href="/privacy" className="hover:text-brand-navy">
                {t('privacy')}
              </Link>
            </li>
            <li>
              <Link href="/terms" className="hover:text-brand-navy">
                {t('terms')}
              </Link>
            </li>
            <li>
              <Link href="/contact" className="hover:text-brand-navy">
                {t('contact')}
              </Link>
            </li>
          </ul>
        </nav>

        <div className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-wider text-brand-navy">
            {t('localeHeading')}
          </h2>
          <LanguageToggle className="px-0" />
        </div>
      </div>

      <p className="mx-auto mt-10 max-w-6xl border-t border-brand-border pt-6 text-center text-xs">
        {t('copyright', { year, name: clinicName, rights: t('rightsReserved') })}
      </p>
    </footer>
  );
}
