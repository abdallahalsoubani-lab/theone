'use client';

import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';

interface Props {
  /** The exact rendered text (server-composed; the custom type is rendered
   *  live by the parent). Null = could not compose. */
  text: string | null;
  /** The template language that goes out — the patient's preference. */
  language: 'AR' | 'EN';
  /** P61 — how many selected patients receive THIS language's card. Omitted
   *  for a single-recipient appointment (no count is shown). */
  recipientCount?: number;
}

/**
 * P60 — the preview card: what the patient will receive, in the patient's
 * language (direction follows the message, not the UI), with a language
 * chip.
 *
 * P61 — one card PER DISTINCT LANGUAGE among the selected recipients, each
 * labelled with how many patients receive it, so the panel never claims to
 * preview a language nobody is getting.
 */
export function SendMessagePreview({ text, language, recipientCount }: Props) {
  const t = useTranslations('appointments.sendMessage');
  const dir = language === 'AR' ? 'rtl' : 'ltr';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-brand-textMuted">
          {recipientCount && recipientCount > 1
            ? t('previewLabelCount', { count: recipientCount })
            : t('previewLabel')}
        </span>
        <Badge variant="muted">{t(`lang.${language}`)}</Badge>
      </div>
      {text ? (
        <div
          dir={dir}
          className="whitespace-pre-wrap rounded-md border border-brand-border bg-brand-bg p-3 text-sm text-brand-text"
        >
          {text}
        </div>
      ) : (
        <p className="text-xs text-brand-textMuted">{t('previewUnavailable')}</p>
      )}
    </div>
  );
}
