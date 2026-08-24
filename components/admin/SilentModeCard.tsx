'use client';

import { BellOff, BellRing } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { setSilentModeAction } from '@/lib/whatsapp/dispatch/actions';

/**
 * P51 — the master hold-all switch (owner option B). ON = no patient-bound
 * WhatsApp message is ever sent automatically (OTP/credentials and
 * human-initiated sends exempt); everything is held in the admin outbox.
 * Admin-only (the settings page + the action both gate on permissions);
 * every flip is audited (SILENT_MODE_ENABLED / DISABLED).
 */
export function SilentModeCard({ enabled }: { enabled: boolean }) {
  const t = useTranslations('admin.settings.silentMode');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const flip = () =>
    startTransition(async () => {
      const r = await setSilentModeAction(!enabled);
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(r.data.on ? t('enabledToast') : t('disabledToast'));
      router.refresh();
    });

  return (
    <section
      className={`rounded-md border p-4 ${
        enabled ? 'border-amber-500/40 bg-amber-500/10' : 'border-brand-border bg-brand-surface'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          {enabled ? (
            <BellOff className="mt-0.5 size-5 shrink-0 text-amber-700" aria-hidden />
          ) : (
            <BellRing className="mt-0.5 size-5 shrink-0 text-brand-textMuted" aria-hidden />
          )}
          <div>
            <p className="text-sm font-semibold text-brand-navy">{t('heading')}</p>
            <p className="mt-0.5 max-w-xl text-xs text-brand-textMuted">
              {enabled ? t('onBanner') : t('offNote')}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant={enabled ? 'outline' : 'default'}
          disabled={pending}
          onClick={flip}
        >
          {enabled ? t('turnOff') : t('turnOn')}
        </Button>
      </div>
    </section>
  );
}
