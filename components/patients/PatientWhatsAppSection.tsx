'use client';

import { CheckCircle2, XCircle } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

interface Props {
  reachable: boolean;
  lastDeliveryAt: Date | null;
  lastFailureAt: Date | null;
  lastFailureReason: string | null;
}

/**
 * WhatsApp reachability badge on the patient Profile tab (Prompt 8 §4.11).
 *
 * The Secretary glances here before booking — if the badge is red they
 * know the next reminder will not reach the patient unless they fix the
 * phone number or, in Twilio Sandbox, ask the patient to opt in again.
 *
 * The "Send test message" admin action lives in the templates UI and is
 * intentionally not duplicated here in v1 (it would need to render only
 * for admins, expand the surface, and largely repeat that flow). The
 * Secretary instead contacts the patient via voice / SMS to fix the
 * issue, which is the real-world workflow.
 */
export function PatientWhatsAppSection({
  reachable,
  lastDeliveryAt,
  lastFailureAt,
  lastFailureReason,
}: Props) {
  const t = useTranslations('whatsapp');
  const locale = useLocale();
  const localeTag = locale === 'ar' ? 'ar' : 'en';

  return (
    <div className="rounded-md border border-brand-border bg-brand-surface p-4">
      <h3 className="mb-2 text-sm font-semibold text-brand-navy">WhatsApp</h3>
      {reachable ? (
        <div className="flex items-start gap-2 text-sm text-brand-text">
          <CheckCircle2 className="mt-0.5 size-4 text-emerald-600" aria-hidden="true" />
          <div>
            <div>{t('reachable')}</div>
            {lastDeliveryAt ? (
              <div className="mt-1 text-xs text-brand-textMuted">
                {t('lastDeliveryAt', { date: lastDeliveryAt.toLocaleString(localeTag) })}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2 text-sm text-brand-text">
          <XCircle className="mt-0.5 size-4 text-red-600" aria-hidden="true" />
          <div>
            <div>{t('unreachable', { reason: lastFailureReason ?? '—' })}</div>
            {lastFailureAt ? (
              <div className="mt-1 text-xs text-brand-textMuted">
                {t('lastFailureAt', { date: lastFailureAt.toLocaleString(localeTag) })}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
