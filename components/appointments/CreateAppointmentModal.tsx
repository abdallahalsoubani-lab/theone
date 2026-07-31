'use client';

import { AppointmentType } from '@prisma/client';
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
import {
  hasHardBlockedConflict,
  hasSamePatientOverlap,
  type ConflictResult,
} from '@/lib/appointments/conflicts';
import type { DayKey } from '@/lib/appointments/conflicts-time';
import { SearchablePillGroup, SearchableSelect } from '@/components/ui/searchable-select';
import { formatClinicDateTimeLocal, parseClinicDateTimeLocal } from '@/lib/time/clinic';
import { addWaitlistEntryAction, fulfillWaitlistEntryAction } from '@/lib/waitlist/actions';

import { CreateSeriesModal } from './CreateSeriesModal';
import { describeConflict } from './conflictText';
import { patientPickerOption } from '@/lib/patients/picker';

interface Patient {
  id: string;
  fullNameEn: string;
  fullNameAr: string;
  /** Null for Doctor viewers — phone hidden from them (Prompt 15 §1). */
  phone: string | null;
  /** NI-5 soft flag (Prompt 41): no completed doctor visit yet. Optional so
   *  older callers (waitlist placement) stay source-compatible. */
  pendingFirstVisit?: boolean;
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
  /** Non-working days (Prompt 22 §4.2) — forwarded to the series builder's
   *  weekday picker. The single-booking datetime-local input can't grey
   *  weekdays natively; its live conflict preview is the feedback there. */
  closedDays?: DayKey[];
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
  closedDays,
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
  // July #8 — booking type. SESSION + STRETCHING + EVENT + GROUP are all
  // selectable. GROUP therapy / workshops (part 3) carry a SET of patients.
  const [appointmentType, setAppointmentType] = useState<AppointmentType>(AppointmentType.SESSION);
  const isStretching = appointmentType === AppointmentType.STRETCHING;
  const isEvent = appointmentType === AppointmentType.EVENT;
  const isGroup = appointmentType === AppointmentType.GROUP;
  // GROUP members (July #8 part 3) — open capacity, ≥1 required.
  const [patientIds, setPatientIds] = useState<string[]>([]);
  const [title, setTitle] = useState('');
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
    setPatientIds([]);
    setAppointmentType(AppointmentType.SESSION);
    setTitle('');
    setTherapistIds(defaultTherapistId ? [defaultTherapistId] : []);
    setStartsAt(defaultStartsAt ? toLocalInput(defaultStartsAt) : '');
    setDuration(defaultDurationMinutes);
  }, [open, defaultStartsAt, defaultTherapistId, defaultDurationMinutes, defaultPatientId]);

  // Switching to STRETCHING clears any picked therapists (it has none).
  useEffect(() => {
    if (isStretching && therapistIds.length > 0) setTherapistIds([]);
  }, [isStretching, therapistIds.length]);

  // Switching to EVENT clears the patient (it is patient-less). Both EVENT and
  // the single-patient types clear the GROUP member set; GROUP clears the
  // single patient (its patients live in the set instead).
  useEffect(() => {
    if (isEvent && patientId) setPatientId('');
  }, [isEvent, patientId]);
  useEffect(() => {
    if (isGroup && patientId) setPatientId('');
  }, [isGroup, patientId]);
  useEffect(() => {
    if (!isGroup && patientIds.length > 0) setPatientIds([]);
  }, [isGroup, patientIds.length]);

  const therapistKey = therapistIds.join(',');
  const groupPatientsKey = patientIds.join(',');

  // Live conflict preview — debounced. Each type gates on what it needs:
  // SESSION on a therapist, STRETCHING on a room (bed capacity), EVENT on a
  // therapist OR room (either can clash).
  useEffect(() => {
    const ready = isEvent
      ? startsAt && (therapistIds.length > 0 || roomId)
      : isGroup
        ? startsAt && therapistIds.length > 0
        : isStretching
          ? patientId && roomId && startsAt
          : patientId && therapistIds.length > 0 && startsAt;
    if (!ready) {
      setConflicts(null);
      return;
    }
    const handle = setTimeout(() => {
      void previewConflictsAction({
        // GROUP members ride in `patientIds` — every member runs the
        // same-patient overlap check (R-22, Prompt 42).
        patientId: isEvent || isGroup ? null : patientId,
        patientIds: isGroup ? patientIds : [],
        therapistIds,
        // The picker value is CLINIC wall time — parse it as such, never via
        // `new Date(string)` (machine-timezone dependent). Prompt 31.
        startsAt: (parseClinicDateTimeLocal(startsAt) ?? new Date(NaN)).toISOString(),
        durationMinutes: duration,
        appointmentType,
        roomId: roomId || null,
      }).then((r) => {
        if (r.ok) setConflicts(r.data);
      });
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, groupPatientsKey, therapistKey, startsAt, duration, appointmentType, roomId]);

  const hasConflicts = conflicts && !conflicts.ok;
  // Same-patient overlap is a hard block (QA retest #15, re-ruled in R-22 /
  // Prompt 42): "Add anyway" is never offered — but "Add to waiting list"
  // REMAINS available for it (parking for a freed slot books nothing). The
  // server enforces the block; the UI hides only the override path.
  const hardBlocked = Boolean(
    conflicts && !conflicts.ok && hasHardBlockedConflict(conflicts.conflicts),
  );
  const waitlistStillAllowed = Boolean(
    conflicts &&
    !conflicts.ok &&
    hasSamePatientOverlap(conflicts.conflicts) &&
    !waitlistEntryId &&
    patientId,
  );
  // Per-type submit gate (July #8). SESSION: patient + room + ≥1 therapist.
  // STRETCHING: patient + room + 0 therapists. EVENT: a title + start (patient
  // forbidden; therapists + room optional). GROUP: ≥1 member + ≥1 therapist +
  // start (room optional; title is the optional workshop label).
  const canSubmit = Boolean(
    startsAt &&
    (isEvent
      ? Boolean(title.trim())
      : isGroup
        ? patientIds.length > 0 && therapistIds.length > 0
        : patientId &&
          roomId &&
          (isStretching ? therapistIds.length === 0 : therapistIds.length > 0)),
  );

  const toggleTherapist = (id: string) =>
    setTherapistIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const togglePatient = (id: string) =>
    setPatientIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const submit = (override: boolean) =>
    startTransition(async () => {
      const r = await createAppointmentAction({
        patientId: isEvent || isGroup ? null : patientId,
        patientIds: isGroup ? patientIds : [],
        therapistIds,
        roomId: roomId || null,
        appointmentType,
        // EVENT: required label. GROUP: optional workshop name.
        title: isEvent ? title.trim() : isGroup && title.trim() ? title.trim() : null,
        startsAt: parseClinicDateTimeLocal(startsAt) ?? new Date(NaN),
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
      const start = parseClinicDateTimeLocal(startsAt) ?? new Date(NaN);
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
              <Label htmlFor="appt-type">{t('type')}</Label>
              <select
                id="appt-type"
                value={appointmentType}
                onChange={(e) => setAppointmentType(e.target.value as AppointmentType)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value={AppointmentType.SESSION}>{t('typeSession')}</option>
                <option value={AppointmentType.STRETCHING}>{t('typeStretching')}</option>
                <option value={AppointmentType.EVENT}>{t('typeEvent')}</option>
                <option value={AppointmentType.GROUP}>{t('typeGroup')}</option>
              </select>
              {isStretching ? (
                <p className="text-xs text-brand-textMuted">{t('stretchingHint')}</p>
              ) : null}
              {isEvent ? <p className="text-xs text-brand-textMuted">{t('eventHint')}</p> : null}
              {isGroup ? <p className="text-xs text-brand-textMuted">{t('groupHint')}</p> : null}
            </div>

            {isEvent ? (
              <div className="space-y-1">
                <Label htmlFor="appt-title">
                  {t('eventTitle')} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="appt-title"
                  value={title}
                  maxLength={200}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t('eventTitlePlaceholder')}
                />
              </div>
            ) : isGroup ? (
              <>
                <div className="space-y-1">
                  <Label htmlFor="appt-title">{t('groupTitle')}</Label>
                  <Input
                    id="appt-title"
                    value={title}
                    maxLength={200}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t('groupTitlePlaceholder')}
                  />
                </div>
                <div className="space-y-1">
                  <Label>
                    {t('groupPatients')} <span className="text-destructive">*</span>
                  </Label>
                  {/* Prompt 47 — filterable member wall (P30). Selections
                      never disappear while filtering. */}
                  <SearchablePillGroup
                    tone="teal"
                    options={patients.map((p) => ({
                      ...patientPickerOption(p, locale),
                    }))}
                    selectedIds={patientIds}
                    onToggle={togglePatient}
                  />
                  <p className="text-xs text-brand-textMuted">
                    {patientIds.length > 0
                      ? t('groupPatientsCount', { count: String(patientIds.length) })
                      : t('groupPatientsHint')}
                  </p>
                </div>
              </>
            ) : (
              <div className="space-y-1">
                <Label htmlFor="appt-patient">{t('patient')}</Label>
                {/* Prompt 47 — searchable picker. Both scripts searched via
                    label+sublabel; phone appears (and thus matches) only when
                    the viewer may see it (P15: it's null otherwise). */}
                <SearchableSelect
                  id="appt-patient"
                  value={patientId}
                  onChange={setPatientId}
                  options={patients.map((p) => patientPickerOption(p, locale))}
                />
                {/* The P41 first-visit notice used to render here — removed
                    by clinic request (Prompt 55 §3). The derived flag, the
                    patients-list badge, and the book-doctor CTA all stay. */}
              </div>
            )}

            {isStretching ? null : (
              <div className="space-y-1">
                <Label>{t('therapists')}</Label>
                {/* Prompt 47 — filterable clinician wall (P20 multi-select).
                    The P41 doctor-scoping arrives pre-filtered via the
                    `clinicians` prop, untouched here. */}
                <SearchablePillGroup
                  options={clinicians.map((c) => ({
                    id: c.id,
                    label: locale === 'ar' ? c.fullNameAr : c.fullNameEn,
                    sublabel: locale === 'ar' ? c.fullNameEn : c.fullNameAr,
                  }))}
                  selectedIds={therapistIds}
                  onToggle={toggleTherapist}
                />
                {therapistIds.length === 0 ? (
                  <p className="text-xs text-brand-textMuted">{t('therapistsHint')}</p>
                ) : null}
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="appt-room">
                {t('room')}{' '}
                {isEvent || isGroup ? null : <span className="text-destructive">*</span>}
              </Label>
              <select
                id="appt-room"
                value={roomId}
                required
                onChange={(e) => setRoomId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">{t('roomPlaceholder')}</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              {!roomId && !isEvent && !isGroup ? (
                <p className="text-xs text-brand-textMuted">{t('roomRequired')}</p>
              ) : null}
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
                className={`space-y-1 rounded-md border p-3 text-sm ${
                  hardBlocked
                    ? 'border-red-200 bg-red-50 text-red-900'
                    : 'border-amber-200 bg-amber-50 text-amber-900'
                }`}
              >
                <p className="font-medium">
                  {hardBlocked ? tConflicts('hardBlockTitle') : tConflicts('title')}
                </p>
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
              {tSeries('batchToggle')}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              {tCommon('cancel')}
            </Button>
            {hasConflicts ? (
              hardBlocked ? (
                // R-22 ruling (Prompt 42): the same-patient overlap rejection
                // keeps "Add to waiting list" (books nothing) — "Add anyway"
                // stays withheld for every hard-blocked kind.
                <>
                  {waitlistStillAllowed ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={pending || !canSubmit}
                      onClick={addToWaitlist}
                    >
                      {tWaitlist('addToWaitlist')}
                    </Button>
                  ) : null}
                  <Button type="button" disabled>
                    {tConflicts('cancelButton')}
                  </Button>
                </>
              ) : (
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
              )
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
        closedDays={closedDays}
      />
    </>
  );
}

/** Instant → clinic-wall picker value (was browser-local before Prompt 31). */
function toLocalInput(d: Date): string {
  return formatClinicDateTimeLocal(d);
}
