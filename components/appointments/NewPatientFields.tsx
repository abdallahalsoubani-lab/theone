'use client';

import { IntakeType } from '@prisma/client';
import { useLocale, useTranslations } from 'next-intl';

import { useSharedPhoneHolders } from '@/components/patients/useSharedPhoneHolders';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { sharedPhoneHolderNames } from '@/lib/patients/shared-phone';

export interface NewPatientDraft {
  fullNameEn: string;
  phone: string;
  formType: IntakeType;
}

/**
 * P52 — the new-patient sub-form inside the booking modal. English name +
 * phone ONLY (owner decision 1), plus the adult/child selector the secretary
 * sets so the personal link opens the right form (decision 2).
 *
 * P57 — shared family numbers: a live "shared number with: …" hint appears
 * under the phone as soon as it is complete (Secretary/Admin only — the
 * action is the privacy gate). Submitting against a held number surfaces
 * the P50-style confirm INLINE (`sharedConfirm`): "save anyway" resubmits
 * with the flag, "use this patient" switches to the existing record when
 * exactly one holds it. One extra click, never a block (P52 decision 5
 * reversed, clinic-approved).
 */
export function NewPatientFields({
  value,
  onChange,
  dupWarning,
  onUseExisting,
  sharedConfirm,
  onConfirmShared,
}: {
  value: NewPatientDraft;
  onChange: (patch: Partial<NewPatientDraft>) => void;
  dupWarning: { name: string } | null;
  onUseExisting: () => void;
  /** Set after PATIENT_PHONE_SHARED_CONFIRM — the holders' joined names. */
  sharedConfirm: { names: string } | null;
  onConfirmShared: () => void;
}) {
  const t = useTranslations('appointments.newPatient');
  const tForm = useTranslations('patients.form');
  const locale = useLocale();
  const holders = useSharedPhoneHolders(value.phone);

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
        {holders.length > 0 && !sharedConfirm ? (
          <p className="mt-1 text-xs text-brand-textMuted" data-testid="shared-phone-hint">
            {tForm('sharedWith', { names: sharedPhoneHolderNames(holders, locale) })}
          </p>
        ) : null}
        {sharedConfirm ? (
          <div
            role="alert"
            className="mt-1 space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-800"
          >
            <p className="font-medium">{tForm('sharedPhoneTitle')}</p>
            <p>{tForm('sharedWith', { names: sharedConfirm.names })}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={onConfirmShared}>
                {tForm('saveAnyway')}
              </Button>
              {dupWarning ? (
                <Button type="button" size="sm" variant="outline" onClick={onUseExisting}>
                  {t('useExisting')}
                </Button>
              ) : null}
            </div>
          </div>
        ) : dupWarning ? (
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
