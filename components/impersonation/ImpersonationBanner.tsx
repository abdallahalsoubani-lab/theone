import { getLocale, getTranslations } from 'next-intl/server';

import { getEffectiveSession } from '@/lib/impersonation/session';

import { ExitImpersonationButton } from './ExitImpersonationButton';

/**
 * Persistent banner displayed at the very top of the layout while an Admin
 * impersonation session is active (Prompt 13 §3.8). Renders nothing for
 * normal sessions so the cost is one DB user-lookup + one cookie read.
 *
 * The banner is rendered server-side from the root layout so the first
 * paint already shows the warning — no flash of "I am Admin" before the
 * client-side hydration realises impersonation is on.
 */
export async function ImpersonationBanner() {
  const session = await getEffectiveSession();
  if (!session?.isImpersonating) return null;

  const locale = await getLocale();
  const t = await getTranslations('impersonation');

  const name = locale === 'ar' ? session.user.fullNameAr : session.user.fullNameEn;
  const role = t(`role_${session.user.role as 'PATIENT' | 'SECRETARY' | 'DOCTOR' | 'THERAPIST'}`);

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-50 flex w-full items-center justify-between gap-3 border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-900 sm:px-6"
    >
      <div className="flex min-w-0 flex-1 flex-col leading-tight sm:flex-row sm:items-center sm:gap-3">
        <span className="truncate font-medium">{t('banner_acting_as', { name, role })}</span>
        <span className="truncate text-xs text-amber-800/80">{t('banner_admin_session')}</span>
      </div>
      <ExitImpersonationButton label={t('banner_exit')} />
    </div>
  );
}
