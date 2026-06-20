'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from '@/components/ui/responsive-modal';
import { createAppointmentAction, previewConflictsAction } from '@/lib/appointments/actions';
import type { ConflictResult } from '@/lib/appointments/conflicts';
import { addWaitlistEntryAction, fulfillWaitlistEntryAction } from '@/lib/waitlist/actions';

import { CreateSeriesModal } from './CreateSeriesModal';

interface Patient {
  id: string;
  fullNameEn: string;
  fullNameAr: string;
  /** Null for Doctor viewers — phone hidden from them (Prompt 15 §1). */
  phone: string | null;
}

interface Clinician {
  id: string;
  fullNameEn: string;
  fullNameAr: string;
}

interface Room {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  patients: Patient[];
  clinicians: Clinician[];
  rooms: Room[];
  defaultStartsAt: Date | null;
  defaultTherapistId?: string;
  defaultDurationMinutes: number;
  canOverride: boolean;
  /** Prompt 19 — prefill the patient (one-click placement / add-to-waitlist). */
  defaultPatientId?: string;
  /**
   * Prompt 19 — placement mode. When set, a successful booking also marks this
   * waitlist entry FULFILLED (linked to the new appointment).
   */
  waitlistEntryId?: string;
}

/**
 * Create appointment modal — Prompt 7 §4.5.
 *
 * Live conflict preview (debounced 300ms) calls previewConflictsAction.
 * On submit with conflicts present the Save button switches to "Save
 * anyway" — requires appointments.override_conflict to actually commit.
 */
export function CreateAppointmentModal({
  open,
  onClose,
  patients,
  clinicians,
  rooms,
  defaultStartsAt,
  defaultTherapistId,
  defaultDurationMinutes,
  canOverride,
  defaultPatientId,
  waitlistEntryId,
}: Props) {
  const t = useTranslations('appointments.form');
  const tCommon = useTranslations('common');
  const tToasts = useTranslations('appointments.toasts');
  const tConflicts = useTranslations('appointments.conflicts');
  const tSeries = useTranslations('calendar.series');
  const tWaitlist = useTranslations('waitlist');
  const router = useRouter();
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  // Recurring-series builder (Prompt 7b §4.4). The button below the
  // standard form swaps the dialog out for the series modal — staying
  // in the same overlay so the Secretary doesn't lose their context.
  const [seriesOpen, setSeriesOpen] = useState(false);

  const [patientId, setPatientId] = useState(defaultPatientId ?? '');
  const [therapistIds, setTherapistIds] = useState<string[]>(
    defaultTherapistId ? [defaultTherapistId] : [],
  );
  const [roomId, setRoomId] = useState<string>('');
  const [startsAt, setStartsAt] = useState<string>(
    defaultStartsAt ? toLocalInput(defaultStartsAt) : '',
  );
  const [duration, setDuration] = useState(defaultDurationMinutes);
  const [notes, setNotes] = useState('');
  const [conflicts, setConflicts] = useState<ConflictResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setPatientId(defaultPatientId ?? '');
    setTherapistIds(defaultTherapistId ? [defaultTherapistId] : []);
    setStartsAt(defaultStartsAt ? toLocalInput(defaultStartsAt) : '');
    setDuration(defaultDurationMinutes);
  }, [open, defaultStartsAt, defaultTherapistId, defaultDurationMinutes, defaultPatientId]);

  const therapistKey = therapistIds.join(',');

  // Live conflict preview — debounced.
  useEffect(() => {
    if (!patientId || therapistIds.length === 0 || !startsAt) {
      setConflicts(null);
      return;
    }
    const handle = setTimeout(() => {
      void previewConflictsAction({
        patientId,
        therapistIds,
        startsAt: new Date(startsAt).toISOString(),
        durationMinutes: duration,
      }).then((r) => {
        if (r.ok) setConflicts(r.data);
      });
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, therapistKey, startsAt, duration]);

  const hasConflicts = conflicts && !conflicts.ok;
  const canSubmit = patientId && therapistIds.length > 0 && startsAt;

  const toggleTherapist = (id: string) =>
    setTherapistIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const submit = (override: boolean) =>
    startTransition(async () => {
      const r = await createAppointmentAction({
        patientId,
        therapistIds,
        roomId: roomId || null,
        startsAt: new Date(startsAt),
        durationMinutes: duration,
        notes: notes || null,
        overrideConflicts: override,
      });
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      // Placement mode (Prompt 19): link the freed booking back to the waitlist
      // entry. The appointment is already committed; a fulfil failure only logs.
      if (waitlistEntryId) {
        const fr = await fulfillWaitlistEntryAction({
          entryId: waitlistEntryId,
          appointmentId: r.data.appointmentId,
        });
        toast[fr.ok ? 'success' : 'error'](
          fr.ok ? tWaitlist('placed') : locale === 'ar' ? fr.error.message_ar : fr.error.message_en,
        );
      } else {
        toast.success(tToasts('created'));
      }
      onClose();
      router.refresh();
    });

  // Add-to-waitlist from the conflict path (Prompt 19 §3.1). Parks the patient
  // for exactly the taken slot ([startsAt, startsAt + duration)), preferring the
  // chosen therapist. The system suggests on free-up — it never auto-books.
  const addToWaitlist = () =>
    startTransition(async () => {
      const start = new Date(startsAt);
      const r = await addWaitlistEntryAction({
        patientId,
        windowStart: start.toISOString(),
        windowEnd: new Date(start.getTime() + duration * 60_000).toISOString(),
        preferredTherapistId: therapistIds[0] ?? null,
        note: null,
      });
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(tWaitlist('added'));
      onClose();
      router.refresh();
    });

  return (
    <>
      <ResponsiveModal open={open && !seriesOpen} onOpenChange={(o) => (o ? null : onClose())}>
        <ResponsiveModalContent>
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>{tCommon('save')}</ResponsiveModalTitle>
            <ResponsiveModalDescription className="sr-only">{t('save')}</ResponsiveModalDescription>
          </ResponsiveModalHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="appt-patient">{t('patient')}</Label>
              <select
                id="appt-patient"
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">—</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {locale === 'ar' ? p.fullNameAr : p.fullNameEn}
                    {p.phone ? ` (${p.phone})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <Label>{t('therapists')}</Label>
              <div className="flex flex-wrap gap-1.5 rounded-md border border-input bg-background p-2">
                {clinicians.map((c) => {
                  const selected = therapistIds.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleTherapist(c.id)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        selected
                          ? 'bg-brand-cyan text-white'
                          : 'bg-brand-bg text-brand-navy hover:bg-brand-cyan/10'
                      }`}
                    >
                      {locale === 'ar' ? c.fullNameAr : c.fullNameEn}
                    </button>
                  );
                })}
              </div>
              {therapistIds.length === 0 ? (
                <p className="text-xs text-brand-textMuted">{t('therapistsHint')}</p>
              ) : null}
            </div>

            <div className="space-y-1">
              <Label htmlFor="appt-room">{t('room')}</Label>
              <select
                id="appt-room"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">—</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
              <div className="space-y-1">
                <Label htmlFor="appt-starts">{t('startsAt')}</Label>
                <Input
                  id="appt-starts"
                  type="datetime-local"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="appt-duration">{t('duration')}</Label>
                <Input
                  id="appt-duration"
                  type="number"
                  inputMode="numeric"
                  min={5}
                  max={480}
                  step={15}
                  value={duration}
                  onChange={(e) => setDuration(parseInt(e.target.value || '30', 10))}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="appt-notes">{t('notes')}</Label>
              <textarea
                id="appt-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>

            {hasConflicts ? (
              <div
                role="alert"
                className="space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
              >
                <p className="font-medium">{tConflicts('title')}</p>
                <ul className="list-disc ps-5 text-xs">
                  {(
                    conflicts as {
                      ok: false;
                      conflicts: typeof conflicts extends { conflicts: infer C } ? C : never;
                    }
                  ).conflicts.map((c, i) => (
                    <li key={i}>{describeConflict(c, tConflicts, locale)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          <ResponsiveModalFooter className="gap-2">
            <Button
              type="button"
              variant="ghost"
              className="me-auto"
              disabled={pending}
              onClick={() => setSeriesOpen(true)}
            >
              {tSeries('recurringToggle')}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              {tCommon('cancel')}
            </Button>
            {hasConflicts ? (
              <>
                {!waitlistEntryId ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending || !canSubmit}
                    onClick={addToWaitlist}
                  >
                    {tWaitlist('addToWaitlist')}
                  </Button>
                ) : null}
                {canOverride ? (
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={pending || !canSubmit}
                    onClick={() => submit(true)}
                  >
                    {tConflicts('overrideButton')}
                  </Button>
                ) : (
                  <Button type="button" disabled>
                    {tConflicts('cancelButton')}
                  </Button>
                )}
              </>
            ) : (
              <Button type="button" disabled={pending || !canSubmit} onClick={() => submit(false)}>
                {t('save')}
              </Button>
            )}
          </ResponsiveModalFooter>
        </ResponsiveModalContent>
      </ResponsiveModal>
      <CreateSeriesModal
        open={open && seriesOpen}
        onClose={() => {
          setSeriesOpen(false);
          onClose();
        }}
        patients={patients}
        clinicians={clinicians}
        rooms={rooms}
        defaultStartsAt={defaultStartsAt}
        defaultTherapistId={defaultTherapistId}
        defaultDurationMinutes={defaultDurationMinutes}
        canOverride={canOverride}
      />
    </>
  );
}

function toLocalInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hr = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${hr}:${min}`;
}

interface Person {
  fullNameEn: string;
  fullNameAr: string;
}
type ConflictType =
  | {
      kind: 'THERAPIST_OVERLAP';
      therapist: Person;
      appointment: { patient: Person; startsAt: Date };
    }
  | {
      kind: 'PATIENT_OVERLAP';
      appointment: { therapists: Person[]; startsAt: Date };
    }
  | { kind: 'THERAPIST_ON_LEAVE'; therapist: Person }
  | {
      kind: 'OUTSIDE_BUSINESS_HOURS';
      reason: 'before_open' | 'after_close' | 'end_exceeds_close';
      openTime: string;
      closeTime: string;
    }
  | { kind: 'CLINIC_CLOSED_THIS_DAY' };

function nm(p: Person, locale: string): string {
  return locale === 'ar' ? p.fullNameAr : p.fullNameEn;
}

function describeConflict(
  c: unknown,
  t: (key: string, params?: Record<string, string>) => string,
  locale: string,
): string {
  const conflict = c as ConflictType;
  switch (conflict.kind) {
    case 'THERAPIST_OVERLAP':
      return t('therapistOverlap', {
        therapist: nm(conflict.therapist, locale),
        patient: nm(conflict.appointment.patient, locale),
        time: new Date(conflict.appointment.startsAt).toISOString(),
      });
    case 'PATIENT_OVERLAP':
      return t('patientOverlap', {
        therapist: conflict.appointment.therapists
          .map((th) => nm(th, locale))
          .join(locale === 'ar' ? '، ' : ', '),
        time: new Date(conflict.appointment.startsAt).toISOString(),
      });
    case 'THERAPIST_ON_LEAVE':
      return t('therapistOnLeave', { therapist: nm(conflict.therapist, locale) });
    case 'OUTSIDE_BUSINESS_HOURS':
      return t(outsideHoursKey(conflict.reason), {
        open: conflict.openTime,
        close: conflict.closeTime,
      });
    case 'CLINIC_CLOSED_THIS_DAY':
      return t('clinicClosedThisDay');
  }
}

/** Map a working-hours reason to its localized message key. */
function outsideHoursKey(reason: 'before_open' | 'after_close' | 'end_exceeds_close'): string {
  switch (reason) {
    case 'before_open':
      return 'beforeOpen';
    case 'after_close':
      return 'afterClose';
    case 'end_exceeds_close':
      return 'endExceedsClose';
  }
}
