'use client';

import { AlertTriangle, Check, Send } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { formatDateTime, formatTime } from '@/lib/format/date';

interface Props {
  /** ISO time of the last non-failed send of this type (decision 7). */
  duplicateAt: string | null;
  /** ISO time of a send just made from this section. */
  sentAt: string | null;
  sending: boolean;
  disabled: boolean;
  /** `confirmResend` = the user explicitly chose "Send again". */
  onSend: (confirmResend: boolean) => void;
}

/**
 * P60 — the duplicate warning + the two-step Send ("Send now?" → confirm).
 * A previous send of the same type is never a silent block: it shows the
 * time it went out and the confirm button reads "Send again".
 */
export function SendMessageActions({ duplicateAt, sentAt, sending, disabled, onSend }: Props) {
  const t = useTranslations('appointments.sendMessage');
  const locale = useLocale();
  const intlLocale: 'en' | 'ar' = locale === 'ar' ? 'ar' : 'en';
  const [confirming, setConfirming] = useState(false);
  const resend = Boolean(duplicateAt);

  return (
    <div className="space-y-2">
      {duplicateAt ? (
        <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-brand-text">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-700" aria-hidden />
          <span>
            {t('duplicateWarning', { time: formatDateTime(new Date(duplicateAt), intlLocale) })}
          </span>
        </p>
      ) : null}

      {sentAt ? (
        <p className="inline-flex items-center gap-1 text-xs text-brand-teal" aria-live="polite">
          <Check className="size-3.5" aria-hidden />
          {t('sentAt', { time: formatTime(new Date(sentAt), intlLocale) })}
        </p>
      ) : null}

      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-brand-navy">{t('confirmPrompt')}</span>
          <Button
            type="button"
            size="sm"
            disabled={sending || disabled}
            onClick={() => {
              setConfirming(false);
              onSend(resend);
            }}
          >
            {sending ? t('sending') : resend ? t('sendAgain') : t('confirmYes')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={sending}
            onClick={() => setConfirming(false)}
          >
            {t('confirmNo')}
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          className="w-full justify-start"
          disabled={sending || disabled}
          onClick={() => setConfirming(true)}
        >
          <Send className="me-2 size-4" aria-hidden />
          {resend ? t('sendAgain') : t('send')}
        </Button>
      )}
    </div>
  );
}
