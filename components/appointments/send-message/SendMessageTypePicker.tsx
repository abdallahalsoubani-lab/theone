'use client';

import { useTranslations } from 'next-intl';

import type { ManualMessageOptionDto } from '@/lib/whatsapp/manual/actions';
import type { ManualMessageType } from '@/lib/whatsapp/manual/types';

interface Props {
  options: ManualMessageOptionDto[];
  selected: ManualMessageType | null;
  onSelect: (type: ManualMessageType) => void;
  /** False while `clinic_custom_message` is pending approval — the custom
   *  type is absent from `options` and a muted note explains why. */
  customApproved: boolean;
}

/** P60 — the message-type pills (only the types applicable to the
 *  appointment's current state arrive here; the server is the authority). */
export function SendMessageTypePicker({ options, selected, onSelect, customApproved }: Props) {
  const t = useTranslations('appointments.sendMessage');

  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-wide text-brand-textMuted">{t('typeLabel')}</p>
      {options.length === 0 ? (
        <p className="text-xs text-brand-textMuted">{t('noTypes')}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('typeLabel')}>
          {options.map((o) => {
            const active = o.type === selected;
            return (
              <button
                key={o.type}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onSelect(o.type)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  active
                    ? 'border-brand-cyan bg-brand-cyan text-white'
                    : 'border-brand-border bg-brand-surface text-brand-text hover:bg-brand-bg'
                }`}
              >
                {t(`types.${o.type}`)}
              </button>
            );
          })}
        </div>
      )}
      {!customApproved ? (
        <p className="text-xs text-brand-textMuted">{t('customPending')}</p>
      ) : null}
    </div>
  );
}
