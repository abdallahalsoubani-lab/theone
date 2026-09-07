'use client';

import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { CUSTOM_TEXT_MAX, normalizeCustomText } from '@/lib/whatsapp/manual/customText';
import type { ManualMessageType } from '@/lib/whatsapp/manual/types';

interface Props {
  type: ManualMessageType;
  /** The exact rendered text (server-composed; the custom type is rendered
   *  live by the parent). Null = could not compose. */
  text: string | null;
  /** The template language that goes out — the patient's preference. */
  language: 'AR' | 'EN';
  customText: string;
  onCustomTextChange: (value: string) => void;
}

/**
 * P60 — the preview card: what the patient will receive, in the patient's
 * language (direction follows the message, not the UI), with a language
 * chip. The custom type adds the textarea above; its normalized length is
 * counted against the WhatsApp parameter cap.
 */
export function SendMessagePreview({
  type,
  text,
  language,
  customText,
  onCustomTextChange,
}: Props) {
  const t = useTranslations('appointments.sendMessage');
  const dir = language === 'AR' ? 'rtl' : 'ltr';
  const normalizedLength = normalizeCustomText(customText).length;
  const overCap = normalizedLength > CUSTOM_TEXT_MAX;

  return (
    <div className="space-y-2">
      {type === 'CUSTOM' ? (
        <div className="space-y-1">
          <textarea
            value={customText}
            onChange={(e) => onCustomTextChange(e.target.value)}
            rows={4}
            dir={dir}
            placeholder={t('customPlaceholder')}
            aria-label={t('types.CUSTOM')}
            className="w-full rounded-md border border-brand-border bg-brand-surface px-3 py-2 text-sm text-brand-text placeholder:text-brand-textMuted focus:outline-none focus:ring-2 focus:ring-brand-cyan"
          />
          <p
            className={`text-xs ${overCap ? 'text-destructive' : 'text-brand-textMuted'}`}
            aria-live="polite"
          >
            {t('customHint', { max: CUSTOM_TEXT_MAX })} ·{' '}
            {t('customCount', { count: normalizedLength, max: CUSTOM_TEXT_MAX })}
          </p>
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-brand-textMuted">
          {t('previewLabel')}
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
