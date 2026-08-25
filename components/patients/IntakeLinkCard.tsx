'use client';

import { Copy, RefreshCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatDateTime } from '@/lib/format/date';
import { regenerateIntakeLinkAction } from '@/lib/intake-links/actions';

export interface IntakeLinkCardData {
  /** The active (unused) link's token, or null when none is active. */
  activeToken: string | null;
  formType: 'ADULT' | 'PEDIATRIC';
  createdAt: string | null;
  usedAt: string | null;
}

/**
 * P52 — the secretary's intake-link panel on the patient file. Shows the
 * active personal link with a copy button + its state (unused / used at
 * {time}), and a regenerate button (SECRETARY/ADMIN, audited) so a link can
 * be re-sent manually if the WhatsApp message never arrived. Old unused
 * links stay valid; regenerating just issues a newer one.
 */
export function IntakeLinkCard({
  patientId,
  data,
}: {
  patientId: string;
  data: IntakeLinkCardData;
}) {
  const t = useTranslations('intake.link');
  const locale = useLocale();
  const intlLocale: 'en' | 'ar' = locale === 'ar' ? 'ar' : 'en';
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [token, setToken] = useState<string | null>(data.activeToken);

  // The actual host the secretary is on — robust for a copyable link.
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  const url = token ? `${base}/${intlLocale}/intake/link/${token}` : null;

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  };

  const regenerate = () =>
    startTransition(async () => {
      const r = await regenerateIntakeLinkAction({ patientId, formType: data.formType });
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      setToken(r.data.token);
      toast.success(t('regenerated'));
      router.refresh();
    });

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-brand-navy">{t('heading')}</h3>
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={regenerate}>
            <RefreshCw className="me-1.5 size-3.5" />
            {t('regenerate')}
          </Button>
        </div>
        {token && url ? (
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={url}
              dir="ltr"
              className="min-w-0 flex-1 truncate rounded-md border border-brand-border bg-brand-bg px-2 py-1.5 text-xs text-brand-textMuted"
            />
            <Button type="button" size="sm" onClick={copy}>
              <Copy className="me-1.5 size-3.5" />
              {t('copy')}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-brand-textMuted">
            {data.usedAt
              ? t('usedAt', { time: formatDateTime(new Date(data.usedAt), intlLocale) })
              : t('noneActive')}
          </p>
        )}
        <p className="text-[11px] text-brand-textMuted">{t('note')}</p>
      </CardContent>
    </Card>
  );
}
