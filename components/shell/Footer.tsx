import { getTranslations } from 'next-intl/server';

/**
 * Site footer — Prompt 3 lands the structural shell.
 * Three-column layout and locale toggle echo are added in commit 2.
 */
export async function Footer() {
  const t = await getTranslations('footer');
  const year = new Date().getFullYear();
  return (
    <footer
      className="border-t border-brand-border bg-brand-bg px-4 py-8 text-sm text-brand-textMuted sm:px-6"
      aria-label={t('clinicNameEn')}
    >
      <p className="text-center">
        {t('copyright', { year, name: t('clinicNameEn'), rights: t('rightsReserved') })}
      </p>
    </footer>
  );
}
