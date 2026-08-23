'use client';

import { AppointmentType } from '@prisma/client';
import { useLocale, useTranslations } from 'next-intl';

import { SearchablePillGroup } from '@/components/ui/searchable-select';
import type { BatchRowDraft } from '@/lib/appointments/batch-validation';
import { BATCH_ROW_TYPES, type BatchRowType } from '@/lib/appointments/schemas';

interface Clinician {
  id: string;
  fullNameEn: string;
  fullNameAr: string;
}

interface Room {
  id: string;
  name: string;
}

/**
 * Prompt 51 — one batch row's type-aware field group: «نوع الحجز» +
 * the fields that depend on it, mirroring the single modal's rules
 * (appointmentCreateSchema / batchRowSchema own the rules, not this UI):
 *   SESSION    → therapist multi-select (≥1), room required;
 *   STRETCHING → no therapist picker (zero therapists), room required,
 *                bed-capacity conflict (Prompt 28).
 * Only SESSION + STRETCHING are offered — EVENT (patient-less) and GROUP
 * (multi-patient) stay single-modal only: every batch row is bound to the
 * shared patient (owner decision 2). Picking STRETCHING clears any
 * therapists already chosen, exactly like the single modal's effect.
 */
export function BatchRowTypeFields({
  index,
  row,
  clinicians,
  rooms,
  onChange,
}: {
  index: number;
  row: BatchRowDraft;
  clinicians: Clinician[];
  rooms: Room[];
  onChange: (patch: Partial<BatchRowDraft>) => void;
}) {
  const t = useTranslations('calendar.series');
  const tForm = useTranslations('appointments.form');
  const locale = useLocale();
  const isStretching = row.appointmentType === AppointmentType.STRETCHING;

  const typeLabel = (type: BatchRowType) =>
    type === AppointmentType.STRETCHING ? tForm('typeStretching') : tForm('typeSession');

  return (
    <>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs text-brand-textMuted">{tForm('type')}</label>
          <select
            value={row.appointmentType}
            onChange={(e) => {
              const next = e.target.value as BatchRowType;
              onChange(
                next === AppointmentType.STRETCHING
                  ? { appointmentType: next, therapistIds: [] }
                  : { appointmentType: next },
              );
            }}
            aria-label={`${tForm('type')} ${index + 1}`}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {BATCH_ROW_TYPES.map((type) => (
              <option key={type} value={type}>
                {typeLabel(type)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-brand-textMuted">
            {t('colRoom')} <span className="text-destructive">*</span>
          </label>
          <select
            value={row.roomId}
            onChange={(e) => onChange({ roomId: e.target.value })}
            aria-label={`${t('colRoom')} ${index + 1}`}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">{tForm('roomPlaceholder')}</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {isStretching ? (
        <p className="mt-2 text-xs text-brand-textMuted">{tForm('stretchingHint')}</p>
      ) : (
        <div className="mt-2 space-y-1">
          <label className="text-xs text-brand-textMuted">{t('colTherapists')}</label>
          <SearchablePillGroup
            options={clinicians.map((c) => ({
              id: c.id,
              label: locale === 'ar' ? c.fullNameAr : c.fullNameEn,
              sublabel: locale === 'ar' ? c.fullNameEn : c.fullNameAr,
            }))}
            selectedIds={row.therapistIds}
            onToggle={(id) =>
              onChange({
                therapistIds: row.therapistIds.includes(id)
                  ? row.therapistIds.filter((x) => x !== id)
                  : [...row.therapistIds, id],
              })
            }
          />
        </div>
      )}
    </>
  );
}
