'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';
import { createAssessmentAction, updateAssessmentAction } from '@/lib/pediatric-assessment/actions';
import {
  CORE_FIELDS,
  CORE_SCHEMA_VERSION,
  CORE_SECTIONS,
  type CoreField,
} from '@/lib/pediatric-assessment/coreFields';
import type { CustomFieldRow } from '@/lib/pediatric-assessment/customFields/queries';

import { FieldControl, type FieldDescriptor, type FieldKind } from './FieldControl';

interface Props {
  mode: 'create' | 'edit';
  patientId: string;
  assessmentId?: string;
  patientName: string;
  dobAge: string;
  today: string;
  initialCore?: Record<string, unknown>;
  initialCustom?: Record<string, unknown>;
  customFields: CustomFieldRow[];
  backHref: string;
  locale: string;
}

export function PediatricAssessmentForm({
  mode,
  patientId,
  assessmentId,
  patientName,
  dobAge,
  today,
  initialCore,
  initialCustom,
  customFields,
  backHref,
  locale,
}: Props) {
  const t = useTranslations('pediatricAssessment');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const ar = locale === 'ar';
  const [pending, startTransition] = useTransition();

  const [core, setCore] = useState<Record<string, unknown>>(() => ({
    schemaVersion: CORE_SCHEMA_VERSION,
    date: today,
    ...(initialCore ?? {}),
  }));
  const [custom, setCustom] = useState<Record<string, unknown>>(initialCustom ?? {});

  const setCoreField = (k: string, v: unknown) => setCore((p) => ({ ...p, [k]: v }));

  const coreDescriptor = (f: CoreField): FieldDescriptor => ({
    id: f.key,
    kind: f.type as FieldKind,
    label: ar ? f.labelAr : f.labelEn,
    // Option values stay verbatim English (clinic decision) — label === value.
    options: f.options?.map((o) => ({ value: o, label: o })),
    required: f.required || (f.requiredWhenShown && shouldShow(f)),
  });

  function shouldShow(f: CoreField): boolean {
    if (!f.showWhen) return true;
    return core[f.showWhen.key] === f.showWhen.equals;
  }

  const customDescriptor = (cf: CustomFieldRow): FieldDescriptor => ({
    id: cf.id,
    kind: cf.type as FieldKind,
    label: ar ? cf.labelAr : cf.labelEn,
    options: cf.options.map((o) => ({ value: o.value, label: ar ? o.labelAr : o.labelEn })),
  });

  function save() {
    startTransition(async () => {
      const payload = {
        coreData: { ...core, schemaVersion: CORE_SCHEMA_VERSION },
        customData: custom,
      };
      const res =
        mode === 'create'
          ? await createAssessmentAction({ patientId, ...payload })
          : await updateAssessmentAction({ id: assessmentId!, ...payload });
      if (!res.ok) {
        toast.error(ar ? res.error.message_ar : res.error.message_en);
        return;
      }
      toast.success(t('saved'));
      router.push(backHref);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6 pb-24">
      {/* Section nav */}
      <nav className="sticky top-0 z-10 flex flex-wrap gap-1.5 border-b border-brand-border bg-brand-bg/90 py-2 backdrop-blur">
        {CORE_SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#sec-${s.id}`}
            className="rounded-md border border-brand-border bg-brand-surface px-2.5 py-1 text-xs text-brand-navy hover:border-brand-cyan"
          >
            {ar ? s.labelAr : s.labelEn}
          </a>
        ))}
        {customFields.length > 0 ? (
          <a
            href="#sec-custom"
            className="rounded-md border border-brand-border bg-brand-surface px-2.5 py-1 text-xs text-brand-navy hover:border-brand-cyan"
          >
            {t('customSection')}
          </a>
        ) : null}
      </nav>

      {/* Prefilled (read-only) header */}
      <div className="rounded-lg border border-brand-border bg-brand-surface p-3 text-sm">
        <p className="font-medium text-brand-navy">{patientName}</p>
        <p className="text-brand-textMuted">{dobAge}</p>
      </div>

      {CORE_SECTIONS.map((s) => {
        const fields = CORE_FIELDS.filter((f) => f.section === s.id && f.type !== 'READONLY');
        return (
          <section key={s.id} id={`sec-${s.id}`} className="scroll-mt-16 space-y-3">
            <h2 className="text-sm font-semibold text-brand-navy">{ar ? s.labelAr : s.labelEn}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {fields.filter(shouldShow).map((f) => (
                <FieldControl
                  key={f.key}
                  field={coreDescriptor(f)}
                  value={core[f.key]}
                  onChange={(v) => setCoreField(f.key, v)}
                  yesLabel={tCommon('yes')}
                  noLabel={tCommon('no')}
                />
              ))}
            </div>
          </section>
        );
      })}

      {customFields.length > 0 ? (
        <section id="sec-custom" className="scroll-mt-16 space-y-3">
          <h2 className="text-sm font-semibold text-brand-navy">{t('customSection')}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {customFields.map((cf) => (
              <FieldControl
                key={cf.id}
                field={customDescriptor(cf)}
                value={custom[cf.id]}
                onChange={(v) => setCustom((p) => ({ ...p, [cf.id]: v }))}
                yesLabel={tCommon('yes')}
                noLabel={tCommon('no')}
              />
            ))}
          </div>
        </section>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 flex justify-end gap-2 border-t border-brand-border bg-brand-bg/95 p-3 backdrop-blur">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push(backHref)}
          disabled={pending}
        >
          {tCommon('cancel')}
        </Button>
        <Button type="button" onClick={save} disabled={pending}>
          {pending ? tCommon('saving') : tCommon('save')}
        </Button>
      </div>
    </div>
  );
}
