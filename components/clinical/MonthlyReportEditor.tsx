'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { saveMonthlyReportAction } from '@/lib/clinical/monthly-reports/actions';

export interface MonthlyReportDraft {
  month: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

/**
 * P64 #11 — write / edit the monthly SOAP report. Picking a month that
 * already has a report loads it for editing (one report per patient per
 * month); the server enforces author / doctor rights.
 */
export function MonthlyReportEditor({
  patientId,
  currentMonth,
  existing,
}: {
  patientId: string;
  /** Clinic month 'YYYY-MM' — the default and the picker's max. */
  currentMonth: string;
  existing: MonthlyReportDraft[];
}) {
  const t = useTranslations('clinical.monthlyReports');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const blank = (month: string): MonthlyReportDraft =>
    existing.find((r) => r.month === month) ?? {
      month,
      subjective: '',
      objective: '',
      assessment: '',
      plan: '',
    };
  const [draft, setDraft] = useState<MonthlyReportDraft>(() => blank(currentMonth));
  const isEdit = existing.some((r) => r.month === draft.month);

  const save = () =>
    startTransition(async () => {
      const r = await saveMonthlyReportAction({ patientId, ...draft });
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(t(r.data.created ? 'createdToast' : 'updatedToast'));
      setOpen(false);
      router.refresh();
    });

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        onClick={() => {
          setDraft(blank(currentMonth));
          setOpen(true);
        }}
      >
        {existing.some((r) => r.month === currentMonth) ? t('editThisMonth') : t('writeThisMonth')}
      </Button>
    );
  }

  const field = (key: 'subjective' | 'objective' | 'assessment' | 'plan', label: string) => (
    <div className="space-y-1">
      <Label htmlFor={`mr-${key}`}>{label}</Label>
      <textarea
        id={`mr-${key}`}
        value={draft[key]}
        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
        rows={3}
        className="block w-full rounded-md border border-brand-border bg-brand-surface p-2 text-sm"
      />
    </div>
  );

  return (
    <form
      className="space-y-3 rounded-md border border-brand-border bg-brand-bg p-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="mr-month">{t('month')}</Label>
          <Input
            id="mr-month"
            type="month"
            value={draft.month}
            max={currentMonth}
            onChange={(e) => e.target.value && setDraft(blank(e.target.value))}
            className="w-44"
          />
        </div>
        <p className="text-xs text-brand-textMuted">{isEdit ? t('editingHint') : t('newHint')}</p>
      </div>
      {field('subjective', t('subjective'))}
      {field('objective', t('objective'))}
      {field('assessment', t('assessment'))}
      {field('plan', t('plan'))}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={pending}>
          {t('save')}
        </Button>
      </div>
    </form>
  );
}
