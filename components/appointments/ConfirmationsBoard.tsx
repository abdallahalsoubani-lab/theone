'use client';

import type { UserRole } from '@prisma/client';
import { CalendarX, ExternalLink } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { CancelAppointmentModal } from '@/components/calendar/CancelAppointmentModal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import type { ReminderConfirmationRow } from '@/lib/appointments/confirmations';
import { formatDate, formatTime } from '@/lib/format/date';
import { formatPhone } from '@/lib/format/phone';
import { patientDisplayName } from '@/lib/format/patientName';
import { patientProfileHref } from '@/lib/patients/links';

/**
 * The Unconfirmed list (Prompt 48b §3.6): reminded appointments in the next
 * 48h grouped Confirmed / Declined / No reply. Cancelling goes through the
 * EXISTING cancel modal — reason dialog, WhatsApp cancellation template,
 * audit, and the P19 waitlist trigger all fire exactly as from the calendar.
 * No auto-cancellation exists anywhere; this list is the conscious human
 * decision the reminder wording promises.
 */
export function ConfirmationsBoard({
  rows,
  viewerRole,
}: {
  rows: ReminderConfirmationRow[];
  viewerRole: UserRole;
}) {
  const t = useTranslations('appointments.confirmations');
  const locale = useLocale();
  const intlLocale: 'en' | 'ar' = locale === 'ar' ? 'ar' : 'en';
  const [cancelTarget, setCancelTarget] = useState<ReminderConfirmationRow | null>(null);

  const groups: Array<{
    key: 'NONE' | 'DECLINED' | 'CONFIRMED';
    heading: string;
    tone: 'destructive' | 'outline' | 'teal';
  }> = [
    { key: 'NONE', heading: t('groupNoReply'), tone: 'destructive' },
    { key: 'DECLINED', heading: t('groupDeclined'), tone: 'outline' },
    { key: 'CONFIRMED', heading: t('groupConfirmed'), tone: 'teal' },
  ];

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-brand-border bg-brand-bg p-6 text-center text-sm text-brand-textMuted">
        {t('empty')}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {groups.map((g) => {
        const groupRows = rows.filter((r) => r.replyState === g.key);
        if (groupRows.length === 0) return null;
        return (
          <section key={g.key} className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-brand-navy">{g.heading}</h3>
              <Badge variant={g.tone === 'teal' ? 'teal' : 'muted'}>{groupRows.length}</Badge>
            </div>
            <div className="overflow-x-auto rounded-md border border-brand-border">
              <table className="w-full text-sm">
                <thead className="bg-brand-bg text-xs text-brand-textMuted">
                  <tr>
                    <th className="p-2 text-start font-medium">{t('colPatient')}</th>
                    <th className="p-2 text-start font-medium">{t('colWhen')}</th>
                    <th className="p-2 text-start font-medium">{t('colTherapist')}</th>
                    <th className="p-2 text-start font-medium">{t('colReminderSent')}</th>
                    <th className="p-2 text-start font-medium">{t('colReply')}</th>
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {groupRows.map((r) => (
                    <tr key={r.appointmentId} className="border-t border-brand-border">
                      <td className="p-2">
                        <div className="flex flex-col">
                          <span className="font-medium text-brand-navy">
                            {patientDisplayName(r.patientFullNameEn, r.patientFullNameAr, locale)}
                          </span>
                          <span className="font-mono text-xs text-brand-textMuted" dir="ltr">
                            {formatPhone(r.patientPhone)}
                          </span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap p-2 tabular-nums">
                        {formatDate(r.startsAt, intlLocale)} · {formatTime(r.startsAt, intlLocale)}
                      </td>
                      <td className="p-2">
                        {r.therapists
                          .map((th) => (locale === 'ar' ? th.fullNameAr : th.fullNameEn))
                          .join(locale === 'ar' ? '، ' : ', ') || '—'}
                      </td>
                      <td className="whitespace-nowrap p-2 text-xs tabular-nums text-brand-textMuted">
                        {r.reminderSentAt ? formatTime(r.reminderSentAt, intlLocale) : '—'}
                      </td>
                      <td className="whitespace-nowrap p-2 text-xs tabular-nums text-brand-textMuted">
                        {r.replyAt ? formatTime(r.replyAt, intlLocale) : '—'}
                      </td>
                      <td className="p-2 text-end">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button asChild size="sm" variant="ghost">
                            <Link
                              href={patientProfileHref(viewerRole, r.patientId) as `/${string}`}
                            >
                              <ExternalLink className="me-1 size-3.5" />
                              {t('openFile')}
                            </Link>
                          </Button>
                          {g.key !== 'CONFIRMED' ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="text-destructive"
                              onClick={() => setCancelTarget(r)}
                            >
                              <CalendarX className="me-1 size-3.5" />
                              {t('cancelAction')}
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {cancelTarget ? (
        <CancelAppointmentModal
          open={cancelTarget !== null}
          appointmentId={cancelTarget.appointmentId}
          seriesId={cancelTarget.seriesId}
          onClose={() => setCancelTarget(null)}
          onCancelled={() => setCancelTarget(null)}
        />
      ) : null}
    </div>
  );
}
