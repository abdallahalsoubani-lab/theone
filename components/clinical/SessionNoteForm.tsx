'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  addSessionNoteAddendumAction,
  createSessionNoteAction,
  updateSessionNoteAction,
} from '@/lib/clinical/session-notes/actions';

interface BaseInitial {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  painScore: number;
  measurements: string;
}

interface Props {
  /** "create" — new primary note; "edit" — edit within 24h; "addendum" — child note. */
  mode: 'create' | 'edit' | 'addendum';
  /** create: appointmentId; edit: noteId; addendum: parentNoteId. */
  targetId: string;
  appointmentLabel: string;
  patientLabel: string;
  initial?: BaseInitial;
  redirectTo: string;
}

/**
 * Shared SOAP form for session notes (Prompt 9 §4.7).
 *
 * Mode flips which action is invoked on submit. All three modes share
 * the same UI surface so the cognitive load on the therapist is low —
 * "fill SOAP, set pain score, save" is one motion regardless of intent.
 *
 * Pain score is a segmented 0-10 selector; the SOAP fields are
 * optional textareas with a comfortable default height. Measurements
 * stays free-form per the Prompt 9 §8 note.
 */
export function SessionNoteForm({
  mode,
  targetId,
  appointmentLabel,
  patientLabel,
  initial,
  redirectTo,
}: Props) {
  const t = useTranslations('clinical.notes');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [subjective, setSubjective] = useState(initial?.subjective ?? '');
  const [objective, setObjective] = useState(initial?.objective ?? '');
  const [assessment, setAssessment] = useState(initial?.assessment ?? '');
  const [plan, setPlan] = useState(initial?.plan ?? '');
  const [painScore, setPainScore] = useState<number>(initial?.painScore ?? 0);
  const [measurements, setMeasurements] = useState(initial?.measurements ?? '');

  function submit() {
    startTransition(async () => {
      const base = {
        subjective: subjective || null,
        objective: objective || null,
        assessment: assessment || null,
        plan: plan || null,
        painScore,
        measurements: measurements || null,
      };
      const r =
        mode === 'create'
          ? await createSessionNoteAction({ appointmentId: targetId, ...base })
          : mode === 'edit'
            ? await updateSessionNoteAction({ noteId: targetId, ...base })
            : await addSessionNoteAddendumAction({ parentNoteId: targetId, ...base });
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(
        t(mode === 'create' ? 'createdToast' : mode === 'edit' ? 'updatedToast' : 'addendumToast'),
      );
      router.push(redirectTo);
      router.refresh();
    });
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="rounded-md border border-brand-border bg-brand-bg p-4">
        <p className="text-xs text-brand-textMuted">{t('appointment')}</p>
        <p className="text-sm font-medium text-brand-navy">{appointmentLabel}</p>
        <p className="mt-1 text-xs text-brand-textMuted">
          {t('patient')}: <span className="text-brand-text">{patientLabel}</span>
        </p>
      </div>

      <SoapField id="s" label={t('subjective')} value={subjective} onChange={setSubjective} />
      <SoapField id="o" label={t('objective')} value={objective} onChange={setObjective} />
      <SoapField id="a" label={t('assessment')} value={assessment} onChange={setAssessment} />
      <SoapField id="p" label={t('planField')} value={plan} onChange={setPlan} />

      <section>
        <Label htmlFor="pain">
          {t('painScore')} <span className="text-red-600">*</span>
        </Label>
        <div role="radiogroup" aria-label={t('painScore')} className="mt-2 flex flex-wrap gap-1">
          {Array.from({ length: 11 }, (_, i) => i).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={painScore === v}
              onClick={() => setPainScore(v)}
              className={`h-9 w-9 rounded-md border text-sm font-medium transition-colors ${
                painScore === v
                  ? 'border-brand-cyan bg-brand-cyan text-white'
                  : 'border-brand-border bg-brand-surface text-brand-text hover:bg-brand-bg'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-brand-textMuted">{t('painScoreHint')}</p>
      </section>

      <section>
        <Label htmlFor="measurements">{t('measurements')}</Label>
        <textarea
          id="measurements"
          value={measurements}
          onChange={(e) => setMeasurements(e.target.value)}
          rows={4}
          placeholder={t('measurementsPlaceholder')}
          className="mt-1 block w-full rounded-md border border-brand-border bg-brand-surface p-2 text-sm"
        />
      </section>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={pending}>
          {mode === 'create' ? t('save') : mode === 'edit' ? t('update') : t('saveAddendum')}
        </Button>
      </div>
    </form>
  );
}

function SoapField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <section>
      <Label htmlFor={id}>{label}</Label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="mt-1 block w-full rounded-md border border-brand-border bg-brand-surface p-2 text-sm"
      />
    </section>
  );
}
