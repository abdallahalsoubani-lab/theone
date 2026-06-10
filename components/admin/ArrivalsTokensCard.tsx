'use client';

import { Copy, KeyRound, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { generateArrivalsTokenAction, revokeArrivalsTokenAction } from '@/lib/arrivals/actions';

type Surface = 'kiosk' | 'display';

/**
 * Admin token management for the two public arrivals surfaces (Prompt 18 §1/§4).
 * Generating reveals the full URL ONCE (the raw token is never re-displayed
 * afterwards — only "active/disabled" status). Revoking clears it immediately.
 */
export function ArrivalsTokensCard({
  locale,
  kioskActive,
  displayActive,
}: {
  locale: string;
  kioskActive: boolean;
  displayActive: boolean;
}) {
  const t = useTranslations('admin.settings.arrivalsTokens');
  return (
    <section className="space-y-4 rounded-lg border border-brand-border bg-brand-surface p-5">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-medium text-brand-navy">
          <KeyRound className="size-4" /> {t('title')}
        </h2>
        <p className="text-sm text-brand-textMuted">{t('subtitle')}</p>
      </div>
      <TokenRow surface="kiosk" path="kiosk" active={kioskActive} locale={locale} />
      <TokenRow surface="display" path="display" active={displayActive} locale={locale} />
    </section>
  );
}

function TokenRow({
  surface,
  path,
  active,
  locale,
}: {
  surface: Surface;
  path: string;
  active: boolean;
  locale: string;
}) {
  const t = useTranslations('admin.settings.arrivalsTokens');
  const [pending, startTransition] = useTransition();
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(active);

  function generate() {
    startTransition(async () => {
      const res = await generateArrivalsTokenAction({ surface });
      if (!res.ok) {
        toast.error(locale === 'ar' ? res.error.message_ar : res.error.message_en);
        return;
      }
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      setFreshUrl(`${origin}/${locale}/${path}?token=${res.data.token}`);
      setIsActive(true);
    });
  }

  function revoke() {
    startTransition(async () => {
      const res = await revokeArrivalsTokenAction({ surface });
      if (!res.ok) {
        toast.error(locale === 'ar' ? res.error.message_ar : res.error.message_en);
        return;
      }
      setFreshUrl(null);
      setIsActive(false);
    });
  }

  return (
    <div className="space-y-2 rounded-md border border-brand-border bg-brand-bg p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium text-brand-navy">{t(`${surface}.label`)}</p>
          <p className="text-xs text-brand-textMuted">
            {isActive ? t('statusActive') : t('statusDisabled')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={pending} onClick={generate}>
            {isActive ? t('regenerate') : t('generate')}
          </Button>
          {isActive && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={revoke}>
              <Trash2 className="size-4" /> {t('revoke')}
            </Button>
          )}
        </div>
      </div>

      {freshUrl && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-brand-teal">{t('copyOnce')}</p>
          <div className="flex items-center gap-2">
            <code
              dir="ltr"
              className="flex-1 truncate rounded bg-brand-surface px-2 py-1.5 text-xs text-brand-navy"
            >
              {freshUrl}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard?.writeText(freshUrl);
                toast.success(t('copied'));
              }}
            >
              <Copy className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
