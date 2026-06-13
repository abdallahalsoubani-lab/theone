'use client';

import { CalendarClock, Plus, Trash2, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { CreateAppointmentModal } from '@/components/appointments/CreateAppointmentModal';
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
import { Link, useRouter } from '@/i18n/navigation';
import type { WaitlistRow } from '@/lib/waitlist/queries';
import { addWaitlistEntryAction, removeWaitlistEntryAction } from '@/lib/waitlist/actions';
import type { WaitlistStatusFilter } from '@/lib/waitlist/schemas';

interface Patient {
  id: string;
  fullNameEn: string;
  fullNameAr: string;
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
  entries: WaitlistRow[];
  statusFilter: WaitlistStatusFilter;
  patients: Patient[];
  clinicians: Clinician[];
  rooms: Room[];
  defaultDurationMinutes: number;
  canManage: boolean;
  canPlace: boolean;
  canOverride: boolean;
  locale: string;
}

const FILTERS: WaitlistStatusFilter[] = ['WAITING', 'FULFILLED', 'EXPIRED', 'REMOVED', 'ALL'];

/**
 * Booking-waitlist desk (Prompt 19 §3). Status-filtered list with add + remove
 * and a one-click "Place" that opens the booking modal prefilled — the
 * secretary always confirms; nothing is auto-booked.
 */
export function WaitlistPanel({
  entries,
  statusFilter,
  patients,
  clinicians,
  rooms,
  defaultDurationMinutes,
  canManage,
  canPlace,
  canOverride,
  locale,
}: Props) {
  const t = useTranslations('waitlist');
  const tStatus = useTranslations('waitlist.status');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [placing, setPlacing] = useState<WaitlistRow | null>(null);

  const patientName = (r: WaitlistRow) => (locale === 'ar' ? r.patientNameAr : r.patientNameEn);
  const therapistName = (r: WaitlistRow) =>
    locale === 'ar' ? r.preferredTherapistNameAr : r.preferredTherapistNameEn;

  const dateStr = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === 'ar' ? 'ar-JO' : 'en-GB', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
    });
  const timeStr = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale === 'ar' ? 'ar-JO' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });

  function remove(id: string) {
    startTransition(async () => {
      const r = await removeWaitlistEntryAction({ id });
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(t('removed'));
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <Link
              key={f}
              href={{ pathname: '/secretary/waitlist', query: { status: f } }}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                f === statusFilter
                  ? 'border-brand-cyan bg-brand-cyan text-white'
                  : 'border-brand-border bg-brand-bg text-brand-navy hover:border-brand-cyan'
              }`}
            >
              {tStatus(f)}
            </Link>
          ))}
        </nav>
        {canManage ? (
          <Button type="button" onClick={() => setAddOpen(true)} disabled={pending}>
            <Plus className="size-4" /> {t('addToWaitlist')}
          </Button>
        ) : null}
      </div>

      {entries.length === 0 ? (
        <p className="rounded-md border border-dashed border-brand-border bg-brand-bg p-6 text-center text-sm text-brand-textMuted">
          {t('empty')}
        </p>
      ) : (
        <ul className="space-y-2">
          {entries.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-border bg-brand-surface p-3"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium text-brand-navy">
                  {patientName(r)}
                  <StatusBadge status={r.status} label={tStatus(r.status)} />
                </p>
                <p className="text-xs text-brand-textMuted">
                  <CalendarClock className="me-1 inline size-3.5 align-[-2px]" />
                  {dateStr(r.windowStart)} · {timeStr(r.windowStart)}–{timeStr(r.windowEnd)}
                  {therapistName(r) ? ` · ${therapistName(r)}` : ` · ${t('anyTherapist')}`}
                </p>
                {r.phone ? <p className="text-xs text-brand-textMuted">{r.phone}</p> : null}
                {r.note ? <p className="text-xs text-brand-textMuted">{r.note}</p> : null}
              </div>
              {r.status === 'WAITING' ? (
                <div className="flex flex-wrap gap-2">
                  {canPlace ? (
                    <Button size="sm" disabled={pending} onClick={() => setPlacing(r)}>
                      <UserPlus className="size-4" /> {t('place')}
                    </Button>
                  ) : null}
                  {canManage ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => remove(r.id)}
                    >
                      <Trash2 className="size-4" /> {t('remove')}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <AddWaitlistDialog
          open={addOpen}
          onClose={() => setAddOpen(false)}
          patients={patients}
          clinicians={clinicians}
          defaultDurationMinutes={defaultDurationMinutes}
          locale={locale}
          onAdded={() => {
            setAddOpen(false);
            router.refresh();
          }}
        />
      ) : null}

      {/* One-click placement — opens the booking modal prefilled. The secretary
          confirms; on success the entry is marked FULFILLED. */}
      {placing ? (
        <CreateAppointmentModal
          open={!!placing}
          onClose={() => setPlacing(null)}
          patients={patients}
          clinicians={clinicians}
          rooms={rooms}
          defaultStartsAt={new Date(placing.windowStart)}
          defaultTherapistId={placing.preferredTherapistId ?? undefined}
          defaultPatientId={placing.patientId}
          waitlistEntryId={placing.id}
          defaultDurationMinutes={defaultDurationMinutes}
          canOverride={canOverride}
        />
      ) : null}
    </div>
  );
}

function StatusBadge({ status, label }: { status: WaitlistRow['status']; label: string }) {
  const cls =
    status === 'WAITING'
      ? 'bg-brand-cyan/15 text-brand-cyan ring-brand-cyan/30'
      : status === 'FULFILLED'
        ? 'bg-brand-teal/15 text-brand-teal ring-brand-teal/30'
        : 'bg-brand-bg text-brand-textMuted ring-brand-border';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${cls}`}>
      {label}
    </span>
  );
}

function AddWaitlistDialog({
  open,
  onClose,
  patients,
  clinicians,
  defaultDurationMinutes,
  locale,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  patients: Patient[];
  clinicians: Clinician[];
  defaultDurationMinutes: number;
  locale: string;
  onAdded: () => void;
}) {
  const t = useTranslations('waitlist');
  const tCommon = useTranslations('common');
  const [pending, startTransition] = useTransition();
  const [patientId, setPatientId] = useState('');
  const [date, setDate] = useState('');
  const [fromTime, setFromTime] = useState('');
  const [toTime, setToTime] = useState('');
  const [therapistId, setTherapistId] = useState('');
  const [note, setNote] = useState('');

  function submit() {
    startTransition(async () => {
      const windowStart = new Date(`${date}T${fromTime}`);
      const windowEnd = new Date(`${date}T${toTime}`);
      const r = await addWaitlistEntryAction({
        patientId,
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        preferredTherapistId: therapistId || null,
        note: note || null,
      });
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(t('added'));
      setPatientId('');
      setDate('');
      setFromTime('');
      setToTime('');
      setTherapistId('');
      setNote('');
      onAdded();
    });
  }

  // Default the "to" time one slot-length after "from" when the user leaves it blank.
  const onFromChange = (v: string) => {
    setFromTime(v);
    if (v && !toTime) {
      const [hPart, mPart] = v.split(':');
      const h = parseInt(hPart ?? '0', 10);
      const m = parseInt(mPart ?? '0', 10);
      const end = new Date();
      end.setHours(h, m + defaultDurationMinutes, 0, 0);
      setToTime(
        `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`,
      );
    }
  };

  const valid = patientId && date && fromTime && toTime && toTime > fromTime;

  return (
    <ResponsiveModal open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <ResponsiveModalContent>
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>{t('addToWaitlist')}</ResponsiveModalTitle>
          <ResponsiveModalDescription className="sr-only">
            {t('subtitle')}
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="wl-patient">{t('patient')}</Label>
            <select
              id="wl-patient"
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
            <Label htmlFor="wl-date">{t('desiredDate')}</Label>
            <Input
              id="wl-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="wl-from">{t('windowFrom')}</Label>
              <Input
                id="wl-from"
                type="time"
                value={fromTime}
                onChange={(e) => onFromChange(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="wl-to">{t('windowTo')}</Label>
              <Input
                id="wl-to"
                type="time"
                value={toTime}
                onChange={(e) => setToTime(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="wl-therapist">{t('preferredTherapist')}</Label>
            <select
              id="wl-therapist"
              value={therapistId}
              onChange={(e) => setTherapistId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">{t('anyTherapist')}</option>
              {clinicians.map((c) => (
                <option key={c.id} value={c.id}>
                  {locale === 'ar' ? c.fullNameAr : c.fullNameEn}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="wl-note">{t('note')}</Label>
            <textarea
              id="wl-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>

        <ResponsiveModalFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            {tCommon('cancel')}
          </Button>
          <Button type="button" onClick={submit} disabled={pending || !valid}>
            {t('add')}
          </Button>
        </ResponsiveModalFooter>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
