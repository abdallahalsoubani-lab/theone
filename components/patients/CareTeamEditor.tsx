'use client';

import { X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { SearchableSelect } from '@/components/ui/searchable-select';
import type { ClinicianRef } from '@/lib/patients/assignment';

interface GroupProps {
  heading: string;
  addLabel: string;
  selected: ClinicianRef[];
  options: ClinicianRef[];
  onAdd: (clinicianId: string) => void;
  onRemove: (clinicianId: string) => void;
  disabled?: boolean;
}

/**
 * Presentational care-team editor: two groups (therapists, doctors), each a
 * set of removable chips plus an "add" dropdown of the not-yet-selected
 * clinicians. Stateless — the parent owns the selection and supplies
 * onAdd / onRemove (local form state on create, server actions on edit).
 * RTL-safe: chips wrap with logical gap and use logical icon placement.
 */
export function CareTeamEditor({
  therapists,
  doctors,
  therapistOptions,
  doctorOptions,
  onAdd,
  onRemove,
  disabled,
}: {
  therapists: ClinicianRef[];
  doctors: ClinicianRef[];
  therapistOptions: ClinicianRef[];
  doctorOptions: ClinicianRef[];
  onAdd: (clinicianId: string) => void;
  onRemove: (clinicianId: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('patients.careTeam');
  return (
    <div className="space-y-6">
      <Group
        heading={t('therapists')}
        addLabel={t('addTherapist')}
        selected={therapists}
        options={therapistOptions}
        onAdd={onAdd}
        onRemove={onRemove}
        disabled={disabled}
      />
      <Group
        heading={t('doctors')}
        addLabel={t('addDoctor')}
        selected={doctors}
        options={doctorOptions}
        onAdd={onAdd}
        onRemove={onRemove}
        disabled={disabled}
      />
    </div>
  );
}

function Group({ heading, addLabel, selected, options, onAdd, onRemove, disabled }: GroupProps) {
  const t = useTranslations('patients.careTeam');
  const locale = useLocale();
  const name = (c: ClinicianRef) => (locale === 'ar' ? c.fullNameAr : c.fullNameEn);
  const selectedIds = new Set(selected.map((c) => c.id));
  const available = options.filter((c) => !selectedIds.has(c.id));

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-brand-navy">{heading}</p>
      {selected.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {selected.map((c) => (
            <li
              key={c.id}
              className="inline-flex items-center gap-1.5 rounded-full bg-brand-cyan/10 py-1 pe-1 ps-3 text-sm text-brand-navy"
            >
              <span>{name(c)}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onRemove(c.id)}
                aria-label={`${t('remove')} ${name(c)}`}
                className="inline-flex size-5 items-center justify-center rounded-full text-brand-textMuted hover:bg-brand-navy/10 hover:text-brand-navy disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-brand-textMuted">{t('none')}</p>
      )}
      {/* Prompt 47 — searchable add-picker. value stays '' (add-only). */}
      <SearchableSelect
        value=""
        disabled={disabled || available.length === 0}
        onChange={(id) => {
          if (id) onAdd(id);
        }}
        clearable={false}
        emptyValueLabel={addLabel}
        options={available.map((c) => ({
          id: c.id,
          label: name(c),
          sublabel: locale === 'ar' ? c.fullNameEn : c.fullNameAr,
        }))}
        className="sm:w-72"
      />
    </div>
  );
}
