'use client';

import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { patientDisplayName } from '@/lib/format/patientName';
import type { ManualRecipientDto } from '@/lib/whatsapp/manual/actions';

interface Props {
  recipients: ManualRecipientDto[];
  /** Patients the selected type applies to right now (arrival is per
   *  membership) — everyone else is listed but not selectable. */
  applicableIds: string[];
  selectedIds: string[];
  onToggle: (patientId: string) => void;
  /** patientId → ISO time this type was last sent to them. */
  lastSentByRecipient: Record<string, string>;
}

/**
 * P61 §1.3.2 — the recipient list for a multi-patient appointment (GROUP /
 * workshop). Every patient is checked by default; a patient with no phone
 * on file, or one the selected type does not apply to, is shown disabled
 * with the reason rather than silently dropped.
 *
 * Never renders a phone number: the section is SECRETARY/ADMIN-only, but
 * P15 keeps contact PII off surfaces that don't need it.
 */
export function SendMessageRecipients({
  recipients,
  applicableIds,
  selectedIds,
  onToggle,
  lastSentByRecipient,
}: Props) {
  const t = useTranslations('appointments.sendMessage');

  return (
    <fieldset className="space-y-1.5">
      <legend className="text-xs uppercase tracking-wide text-brand-textMuted">
        {t('recipientsLabel', { count: recipients.length })}
      </legend>
      <ul className="space-y-1">
        {recipients.map((r) => {
          const applicable = applicableIds.includes(r.patientId);
          const disabled = !r.hasPhone || !applicable;
          const checked = selectedIds.includes(r.patientId);
          return (
            <li key={r.patientId}>
              <label
                className={`flex items-center gap-2 rounded-md border border-brand-border p-2 text-sm ${
                  disabled ? 'opacity-60' : 'cursor-pointer hover:bg-brand-bg'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => onToggle(r.patientId)}
                  className="size-4 accent-brand-cyan"
                />
                <span className="min-w-0 flex-1 truncate text-brand-text">
                  {patientDisplayName(r.fullNameEn, r.fullNameAr)}
                </span>
                {lastSentByRecipient[r.patientId] ? (
                  <Badge variant="muted">{t('alreadySentChip')}</Badge>
                ) : null}
                <Badge variant="muted">{t(`lang.${r.language}`)}</Badge>
              </label>
              {!r.hasPhone ? (
                <p className="ps-8 text-xs text-brand-textMuted">{t('recipientNoPhone')}</p>
              ) : !applicable ? (
                <p className="ps-8 text-xs text-brand-textMuted">{t('recipientNotApplicable')}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
