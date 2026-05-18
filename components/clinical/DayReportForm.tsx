'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { submitDayReportAction } from '@/lib/clinical/day-reports/actions';

interface Entry {
  appointmentId: string;
  patientId: string;
  patientFullNameEn: string;
  patientFullNameAr: string;
  note: string;
}

interface Props {
  /** ISO YYYY-MM-DD covering the report date. */
  date: string;
  initialOverallSummary: string;
  initialEntries: Entry[];
}

/**
 * End-of-day report form for Therapists (Prompt 9 §4.9).
 *
 * Pre-populated with the day's completed appointments; the therapist
 * edits per-patient notes inline and writes a free-form overall
 * summary at the bottom. Submission upserts via (therapistId, date).
 */
export function DayReportForm({ date, initialOverallSummary, initialEntries }: Props) {
  const t = useTranslations('clinical.reports');
  const locale = useLocale();
  const router = useRouter();
  const [overallSummary, setOverallSummary] = useState(initialOverallSummary);
  const [entries, setEntries] = useState(initialEntries);
  const [pending, startTransition] = useTransition();

  function updateEntry(appointmentId: string, note: string) {
    setEntries((prev) => prev.map((e) => (e.appointmentId === appointmentId ? { ...e, note } : e)));
  }

  function submit() {
    startTransition(async () => {
      const r = await submitDayReportAction({
        date,
        overallSummary,
        patientEntries: entries.map((e) => ({
          patientId: e.patientId,
          appointmentId: e.appointmentId,
          note: e.note,
        })),
      });
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(t('submittedToast'));
      router.refresh();
    });
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-md border border-brand-border bg-brand-bg p-6 text-sm text-brand-textMuted">
        {t('noCompletedAppointments')}
      </div>
    );
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <ul className="space-y-3">
        {entries.map((entry) => {
          const name = locale === 'ar' ? entry.patientFullNameAr : entry.patientFullNameEn;
          return (
            <li
              key={entry.appointmentId}
              className="space-y-1 rounded-md border border-brand-border bg-brand-surface p-3"
            >
              <p className="text-sm font-medium text-brand-navy">{name}</p>
              <textarea
                value={entry.note}
                onChange={(e) => updateEntry(entry.appointmentId, e.target.value)}
                rows={2}
                className="block w-full rounded-md border border-brand-border bg-brand-surface p-2 text-sm"
              />
            </li>
          );
        })}
      </ul>

      <section>
        <Label htmlFor="summary">{t('overallSummary')}</Label>
        <textarea
          id="summary"
          value={overallSummary}
          onChange={(e) => setOverallSummary(e.target.value)}
          required
          minLength={5}
          rows={4}
          className="mt-1 block w-full rounded-md border border-brand-border bg-brand-surface p-2 text-sm"
        />
      </section>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {t('submit')}
        </Button>
      </div>
    </form>
  );
}
