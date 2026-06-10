'use client';

import { Check, LogIn, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';
import { updateStatusAction } from '@/lib/appointments/actions';
import {
  manualCheckInAction,
  setCurrentDelayAction,
  undoCheckInAction,
} from '@/lib/arrivals/actions';
import type { ArrivalRow, ArrivalsBoard } from '@/lib/arrivals/queries';

const DELAY_PRESETS = [5, 10, 15, 20, 25, 30, 45];
const REFRESH_MS = 15_000;

/**
 * Secretary arrivals desk (Prompt 18 §2, §3). Live waiting list derived from
 * check-in state, manual check-in for walk-ups, status transitions, and the
 * one-tap "current delay" stepper that the kiosk reads. Auto-refreshes so the
 * desk stays in sync with kiosk check-ins.
 */
export function ArrivalsPanel({ board, locale }: { board: ArrivalsBoard; locale: string }) {
  const t = useTranslations('arrivals');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Soft auto-refresh — picks up kiosk check-ins without a manual reload.
  useEffect(() => {
    const id = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [router]);

  const name = (r: ArrivalRow) => (locale === 'ar' ? r.patientNameAr : r.patientNameEn);
  const therapist = (r: ArrivalRow) => (locale === 'ar' ? r.therapistNameAr : r.therapistNameEn);
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale === 'ar' ? 'ar-JO' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });

  function run(
    fn: () => Promise<{ ok: boolean; error?: { message_en: string; message_ar: string } }>,
  ) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok && res.error) {
        toast.error(locale === 'ar' ? res.error.message_ar : res.error.message_en);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      <DelayStepper
        current={board.currentDelayMinutes}
        pending={pending}
        onSet={(minutes) => run(() => setCurrentDelayAction({ minutes }))}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Waiting */}
        <Column title={t('waiting')} count={board.waiting.length} accent="cyan">
          {board.waiting.length === 0 && <Empty label={t('noneWaiting')} />}
          {board.waiting.map((r) => (
            <Card key={r.appointmentId}>
              <Meta
                title={name(r)}
                lines={[
                  `${t('appointmentAt')} ${time(r.startsAt)}`,
                  r.checkedInAt
                    ? `${t('arrivedAt')} ${time(r.checkedInAt)}${r.checkedInVia === 'KIOSK' ? ` · ${t('viaKiosk')}` : ''}`
                    : '',
                  therapist(r),
                ]}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    run(() => updateStatusAction({ id: r.appointmentId, to: 'IN_PROGRESS' }))
                  }
                >
                  <LogIn className="size-4" /> {t('markInSession')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => run(() => undoCheckInAction({ appointmentId: r.appointmentId }))}
                >
                  <RotateCcw className="size-4" /> {t('undoCheckIn')}
                </Button>
              </div>
            </Card>
          ))}
        </Column>

        {/* In session */}
        <Column title={t('inSession')} count={board.inSession.length} accent="teal">
          {board.inSession.length === 0 && <Empty label={t('noneInSession')} />}
          {board.inSession.map((r) => (
            <Card key={r.appointmentId}>
              <Meta
                title={name(r)}
                lines={[therapist(r), `${t('appointmentAt')} ${time(r.startsAt)}`]}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  run(() => updateStatusAction({ id: r.appointmentId, to: 'COMPLETED' }))
                }
              >
                <Check className="size-4" /> {t('markDone')}
              </Button>
            </Card>
          ))}
        </Column>

        {/* Up next — walk-ups checked in manually here */}
        <Column title={t('upNext')} count={board.upNext.length} accent="muted">
          {board.upNext.length === 0 && <Empty label={t('noneUpNext')} />}
          {board.upNext.map((r) => (
            <Card key={r.appointmentId}>
              <Meta
                title={name(r)}
                lines={[therapist(r), `${t('appointmentAt')} ${time(r.startsAt)}`]}
              />
              <Button
                size="sm"
                disabled={pending}
                onClick={() => run(() => manualCheckInAction({ appointmentId: r.appointmentId }))}
              >
                <LogIn className="size-4" /> {t('checkIn')}
              </Button>
            </Card>
          ))}
        </Column>
      </div>
    </div>
  );
}

function DelayStepper({
  current,
  pending,
  onSet,
}: {
  current: number;
  pending: boolean;
  onSet: (minutes: number) => void;
}) {
  const t = useTranslations('arrivals');
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-brand-border bg-brand-surface p-4">
      <div>
        <p className="text-sm font-medium text-brand-navy">{t('currentDelay')}</p>
        <p className="text-xs text-brand-textMuted">{t('currentDelayHint')}</p>
      </div>
      <span className="text-2xl font-medium tabular-nums text-brand-cyan">
        {t('minutesValue', { minutes: current })}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {DELAY_PRESETS.map((m) => (
          <button
            key={m}
            type="button"
            disabled={pending}
            onClick={() => onSet(m)}
            className={`h-9 min-w-9 rounded-md border px-2 text-sm font-medium transition-colors disabled:opacity-50 ${
              m === current
                ? 'border-brand-cyan bg-brand-cyan text-white'
                : 'border-brand-border bg-brand-bg text-brand-navy hover:border-brand-cyan'
            }`}
          >
            {m}
          </button>
        ))}
      </div>
    </div>
  );
}

function Column({
  title,
  count,
  accent,
  children,
}: {
  title: string;
  count: number;
  accent: 'cyan' | 'teal' | 'muted';
  children: React.ReactNode;
}) {
  const bar =
    accent === 'cyan' ? 'bg-brand-cyan' : accent === 'teal' ? 'bg-brand-teal' : 'bg-brand-border';
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-brand-navy">
        <span className={`inline-block h-4 w-1.5 rounded-full ${bar}`} />
        {title}
        <span className="rounded-full bg-brand-bg px-2 text-xs text-brand-textMuted">{count}</span>
      </h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-lg border border-brand-border bg-brand-surface p-3">
      {children}
    </div>
  );
}

function Meta({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div>
      <p className="font-medium text-brand-navy">{title}</p>
      {lines.filter(Boolean).map((l, i) => (
        <p key={i} className="text-xs text-brand-textMuted">
          {l}
        </p>
      ))}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <p className="rounded-md border border-dashed border-brand-border bg-brand-bg p-4 text-sm text-brand-textMuted">
      {label}
    </p>
  );
}
