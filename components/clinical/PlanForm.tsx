'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  createTreatmentPlanAction,
  proposeTreatmentPlanChangeAction,
} from '@/lib/clinical/plans/actions';
import type { ExerciseOption } from '@/lib/clinical/plans/exercises';

export interface PlanFormPatient {
  id: string;
  fullNameEn: string;
  fullNameAr: string;
}

export interface PlanFormTherapist {
  id: string;
  fullNameEn: string;
  fullNameAr: string;
}

export interface PlanFormInitial {
  diagnosisPrimary: string;
  diagnosisSecondary: string | null;
  goalsShortTerm: string;
  goalsLongTerm: string | null;
  frequencyPerWeek: number;
  durationWeeks: number;
  assignedTherapistId: string;
  therapistNotes: string | null;
  exercises: Array<{
    exerciseId: string;
    sets: number;
    reps: number;
    durationSeconds: number;
    customNotes: string | null;
    order: number;
  }>;
}

interface Props {
  /** Doctor-create mode when omitted; therapist-propose when set. */
  activePlanId?: string;
  patient: PlanFormPatient;
  therapists: PlanFormTherapist[];
  exerciseOptions: ExerciseOption[];
  initial?: PlanFormInitial;
  /** Where to navigate on success. */
  redirectTo: string;
}

/**
 * Shared treatment-plan form (Prompt 9 §4.3 + §4.4).
 *
 * Doctors hit `createTreatmentPlanAction`; Therapists pass `activePlanId`
 * and the form switches to `proposeTreatmentPlanChangeAction`, surfacing
 * the required `proposalReason` field.
 *
 * Validation: server actions enforce the canonical Zod schemas; this
 * form does the bare minimum (required attributes + min lengths on
 * textareas) so the user gets immediate feedback. Real errors surface
 * as toasts on submit.
 */
export function PlanForm({
  activePlanId,
  patient,
  therapists,
  exerciseOptions,
  initial,
  redirectTo,
}: Props) {
  const t = useTranslations('clinical.plans');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [diagnosisPrimary, setDiagnosisPrimary] = useState(initial?.diagnosisPrimary ?? '');
  const [diagnosisSecondary, setDiagnosisSecondary] = useState(initial?.diagnosisSecondary ?? '');
  const [goalsShortTerm, setGoalsShortTerm] = useState(initial?.goalsShortTerm ?? '');
  const [goalsLongTerm, setGoalsLongTerm] = useState(initial?.goalsLongTerm ?? '');
  const [frequencyPerWeek, setFrequencyPerWeek] = useState(initial?.frequencyPerWeek ?? 2);
  const [durationWeeks, setDurationWeeks] = useState(initial?.durationWeeks ?? 6);
  const [assignedTherapistId, setAssignedTherapistId] = useState(
    initial?.assignedTherapistId ?? therapists[0]?.id ?? '',
  );
  const [therapistNotes, setTherapistNotes] = useState(initial?.therapistNotes ?? '');
  const [proposalReason, setProposalReason] = useState('');
  const [exercises, setExercises] = useState<PlanFormInitial['exercises']>(
    initial?.exercises ?? [
      {
        exerciseId: exerciseOptions[0]?.id ?? '',
        sets: 3,
        reps: 10,
        durationSeconds: 0,
        customNotes: null,
        order: 0,
      },
    ],
  );

  function addExercise() {
    setExercises((prev) => [
      ...prev,
      {
        exerciseId: exerciseOptions[0]?.id ?? '',
        sets: 3,
        reps: 10,
        durationSeconds: 0,
        customNotes: null,
        order: prev.length,
      },
    ]);
  }

  function removeExercise(index: number) {
    setExercises((prev) => prev.filter((_, i) => i !== index).map((e, i) => ({ ...e, order: i })));
  }

  function updateExercise(index: number, patch: Partial<PlanFormInitial['exercises'][number]>) {
    setExercises((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }

  function submit() {
    if (exercises.length === 0) {
      toast.error(t('errors.exercisesRequired'));
      return;
    }
    startTransition(async () => {
      const payload = {
        patientId: patient.id,
        assignedTherapistId,
        diagnosisPrimary,
        diagnosisSecondary: diagnosisSecondary || null,
        goalsShortTerm,
        goalsLongTerm: goalsLongTerm || null,
        frequencyPerWeek,
        durationWeeks,
        therapistNotes: therapistNotes || null,
        exercises: exercises.map((e, i) => ({ ...e, order: i })),
      };
      const result = activePlanId
        ? await proposeTreatmentPlanChangeAction({
            ...payload,
            activePlanId,
            proposalReason,
          })
        : await createTreatmentPlanAction(payload);
      if (!result.ok) {
        toast.error(locale === 'ar' ? result.error.message_ar : result.error.message_en);
        return;
      }
      toast.success(t(activePlanId ? 'proposedToast' : 'createdToast'));
      router.push(redirectTo);
      router.refresh();
    });
  }

  const patientName = locale === 'ar' ? patient.fullNameAr : patient.fullNameEn;

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="rounded-md border border-brand-border bg-brand-bg p-4">
        <p className="text-xs text-brand-textMuted">{t('patient')}</p>
        <p className="text-base font-medium text-brand-navy">{patientName}</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-brand-navy">{t('diagnosisSection')}</h2>
        <div>
          <Label htmlFor="diagPrimary">{t('diagnosisPrimary')}</Label>
          <textarea
            id="diagPrimary"
            value={diagnosisPrimary}
            onChange={(e) => setDiagnosisPrimary(e.target.value)}
            required
            minLength={5}
            rows={2}
            className="mt-1 block w-full rounded-md border border-brand-border bg-brand-surface p-2 text-sm"
          />
        </div>
        <div>
          <Label htmlFor="diagSecondary">{t('diagnosisSecondary')}</Label>
          <textarea
            id="diagSecondary"
            value={diagnosisSecondary}
            onChange={(e) => setDiagnosisSecondary(e.target.value)}
            rows={2}
            className="mt-1 block w-full rounded-md border border-brand-border bg-brand-surface p-2 text-sm"
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-brand-navy">{t('goalsSection')}</h2>
        <div>
          <Label htmlFor="goalsShort">{t('goalsShort')}</Label>
          <textarea
            id="goalsShort"
            value={goalsShortTerm}
            onChange={(e) => setGoalsShortTerm(e.target.value)}
            required
            minLength={5}
            rows={2}
            className="mt-1 block w-full rounded-md border border-brand-border bg-brand-surface p-2 text-sm"
          />
        </div>
        <div>
          <Label htmlFor="goalsLong">{t('goalsLong')}</Label>
          <textarea
            id="goalsLong"
            value={goalsLongTerm}
            onChange={(e) => setGoalsLongTerm(e.target.value)}
            rows={2}
            className="mt-1 block w-full rounded-md border border-brand-border bg-brand-surface p-2 text-sm"
          />
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="freq">{t('frequencyPerWeek')}</Label>
          <Input
            id="freq"
            type="number"
            min={1}
            max={7}
            value={frequencyPerWeek}
            onChange={(e) => setFrequencyPerWeek(Number(e.target.value) || 1)}
          />
        </div>
        <div>
          <Label htmlFor="dur">{t('durationWeeks')}</Label>
          <Input
            id="dur"
            type="number"
            min={1}
            max={52}
            value={durationWeeks}
            onChange={(e) => setDurationWeeks(Number(e.target.value) || 1)}
          />
        </div>
        <div>
          <Label htmlFor="therapist">{t('assignedTherapist')}</Label>
          <select
            id="therapist"
            value={assignedTherapistId}
            onChange={(e) => setAssignedTherapistId(e.target.value)}
            className="block w-full rounded-md border border-brand-border bg-brand-surface px-2 py-1.5 text-sm"
          >
            {therapists.map((tx) => (
              <option key={tx.id} value={tx.id}>
                {locale === 'ar' ? tx.fullNameAr : tx.fullNameEn}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-brand-navy">{t('exercisesSection')}</h2>
          <Button type="button" variant="outline" size="sm" onClick={addExercise}>
            <Plus className="me-1 size-4" />
            {t('addExercise')}
          </Button>
        </div>
        <ul className="space-y-2">
          {exercises.map((ex, i) => (
            <li
              key={i}
              className="grid items-end gap-2 rounded-md border border-brand-border bg-brand-surface p-3 sm:grid-cols-[2fr_repeat(3,1fr)_auto]"
            >
              <div>
                <Label htmlFor={`ex-${i}`}>{t('exercise')}</Label>
                <select
                  id={`ex-${i}`}
                  value={ex.exerciseId}
                  onChange={(e) => updateExercise(i, { exerciseId: e.target.value })}
                  className="block w-full rounded-md border border-brand-border bg-brand-surface px-2 py-1.5 text-sm"
                >
                  {exerciseOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {locale === 'ar' ? opt.nameAr : opt.nameEn}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor={`sets-${i}`}>{t('sets')}</Label>
                <Input
                  id={`sets-${i}`}
                  type="number"
                  min={1}
                  value={ex.sets}
                  onChange={(e) => updateExercise(i, { sets: Number(e.target.value) || 1 })}
                />
              </div>
              <div>
                <Label htmlFor={`reps-${i}`}>{t('reps')}</Label>
                <Input
                  id={`reps-${i}`}
                  type="number"
                  min={1}
                  value={ex.reps}
                  onChange={(e) => updateExercise(i, { reps: Number(e.target.value) || 1 })}
                />
              </div>
              <div>
                <Label htmlFor={`dur-${i}`}>{t('durationSeconds')}</Label>
                <Input
                  id={`dur-${i}`}
                  type="number"
                  min={0}
                  value={ex.durationSeconds}
                  onChange={(e) =>
                    updateExercise(i, { durationSeconds: Number(e.target.value) || 0 })
                  }
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeExercise(i)}
                aria-label={t('removeExercise')}
                disabled={exercises.length <= 1}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <Label htmlFor="therapistNotes">{t('therapistNotes')}</Label>
        <textarea
          id="therapistNotes"
          value={therapistNotes}
          onChange={(e) => setTherapistNotes(e.target.value)}
          rows={3}
          className="mt-1 block w-full rounded-md border border-brand-border bg-brand-surface p-2 text-sm"
        />
      </section>

      {activePlanId ? (
        <section>
          <Label htmlFor="proposalReason">{t('proposalReason')}</Label>
          <textarea
            id="proposalReason"
            value={proposalReason}
            onChange={(e) => setProposalReason(e.target.value)}
            required
            minLength={10}
            rows={3}
            className="mt-1 block w-full rounded-md border border-brand-border bg-brand-surface p-2 text-sm"
            placeholder={t('proposalReasonPlaceholder')}
          />
        </section>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={pending}>
          {activePlanId ? t('submitProposal') : t('createPlan')}
        </Button>
      </div>
    </form>
  );
}
