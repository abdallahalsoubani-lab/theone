'use client';

import { IntakeType } from '@prisma/client';
import { useTranslations } from 'next-intl';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface NewPatientDraft {
  fullNameEn: string;
  phone: string;
  formType: IntakeType;
}

/**
 * P52 — the new-patient sub-form inside the booking modal. English name +
 * phone ONLY (owner decision 1), plus the adult/child selector the secretary
 * sets so the personal link opens the right form (decision 2). A duplicate-
 * phone warning (with a one-tap "use this patient") is rendered by the modal
 * above the submit — this component only owns the fields.
 */
export function NewPatientFields({
  value,
  onChange,
  dupWarning,
  onUseExisting,
}: {
  value: NewPatientDraft;
  onChange: (patch: Partial<NewPatientDraft>) => void;
  dupWarning: { name: string } | null;
  onUseExisting: () => void;
}) {
  const t = useTranslations('appointments.newPatient');

  return (
    <div className="space-y-3 rounded-md border border-brand-border bg-brand-bg p-3">
      <div className="space-y-1">
        <Label htmlFor="np-name">
          {t('fullNameEn')} <span className="text-destructive">*</span>
        </Label>
        <Input
          id="np-name"
          value={value.fullNameEn}
          maxLength={120}
          dir="ltr"
          placeholder={t('fullNameEnPlaceholder')}
          onChange={(e) => onChange({ fullNameEn: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="np-phone">
          {t('phone')} <span className="text-destructive">*</span>
        </Label>
        <Input
          id="np-phone"
          value={value.phone}
          type="tel"
          inputMode="tel"
          dir="ltr"
          placeholder="07XXXXXXXX"
          onChange={(e) => onChange({ phone: e.target.value })}
        />
        {dupWarning ? (
          <div className="mt-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-800">
            <p>{t('duplicateWarning', { name: dupWarning.name })}</p>
            <button
              type="button"
              onClick={onUseExisting}
              className="mt-1 font-semibold text-brand-blue underline"
            >
              {t('useExisting')}
            </button>
          </div>
        ) : null}
      </div>
      <div className="space-y-1">
        <Label htmlFor="np-formtype">{t('formType')}</Label>
        <select
          id="np-formtype"
          value={value.formType}
          onChange={(e) => onChange({ formType: e.target.value as IntakeType })}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value={IntakeType.ADULT}>{t('formTypeAdult')}</option>
          <option value={IntakeType.PEDIATRIC}>{t('formTypeChild')}</option>
        </select>
        <p className="text-xs text-brand-textMuted">{t('formTypeHint')}</p>
      </div>
    </div>
  );
}
