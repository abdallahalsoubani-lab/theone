import { BellOff } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

/** P51 — the unmistakable state banner shown while silent mode is ON
 *  (settings page + outbox page). Server component; render only when ON. */
export async function SilentModeBanner() {
  const t = await getTranslations('admin.settings.silentMode');
  return (
    <p
      role="status"
      className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-800"
    >
      <BellOff className="size-4 shrink-0" aria-hidden />
      {t('onBanner')}
    </p>
  );
}
