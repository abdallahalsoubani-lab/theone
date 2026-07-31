'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Link } from '@/i18n/navigation';
import {
  kioskCheckInByNameAction,
  kioskTodayAction,
  type KioskActionResult,
} from '@/lib/arrivals/actions';
import type { KioskArrivalRow } from '@/lib/arrivals/kiosk';
import { kioskNamePair } from '@/lib/arrivals/name-pair';
import { formatTime } from '@/lib/format/date';

type Screen =
  | { kind: 'grid' }
  | { kind: 'confirm'; match: KioskArrivalRow }
  | { kind: 'result'; result: KioskActionResult };

const RESET_MS = 8000;
/** List auto-refresh so the day's rows stay current untouched — a secretary
 *  manual check-in removes its row within one poll cycle. 30s (Fix 45.1;
 *  same module-level-constant pattern as the display screen's POLL_MS —
 *  the kiosk polls through a server action, so no URL cache-buster needed). */
const REFRESH_MS = 30_000;

/**
 * Public check-in kiosk (Prompt 18 §1; July #1/#3; cards grid in Prompt 46;
 * time-sorted rows in the July 31 bundle).
 *
 * Today's remaining arrivals render as tappable ROWS sorted by appointment
 * time, earliest first — one row per back-to-back run (open names on the
 * entrance screen: the Prompt 46 owner ruling, re-confirmed July 31). Tap →
 * mandatory confirm ("are you {name}?" — mis-tap guard, clinic re-confirmed
 * it stays) → check-in commits for exactly that run → success with the delay
 * message → auto-reset → the refetched list no longer contains the row (the
 * query excludes checked-in arrivals — removal is data-driven, not a client
 * splice). No staff session; the device token is forwarded to the
 * rate-limited actions.
 */
export function KioskApp({ token, locale }: { token: string; locale: string }) {
  const [screen, setScreen] = useState<Screen>({ kind: 'grid' });
  const [rows, setRows] = useState<KioskArrivalRow[] | null>(null);
  const [pending, setPending] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    const res = await kioskTodayAction({ token });
    // Rate-limit / token hiccups keep the last good list on screen.
    if (res.kind === 'ROWS') setRows(res.rows);
  }, [token]);

  // Load on mount + refresh periodically while the grid is showing.
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (screen.kind !== 'grid') return;
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [screen.kind, refresh]);

  const reset = useCallback(() => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    setPending(false);
    setScreen({ kind: 'grid' });
    void refresh(); // idle reset re-pulls the day's list (Prompt 46)
  }, [refresh]);

  // Auto-return to the grid a few seconds after showing a result.
  useEffect(() => {
    if (screen.kind !== 'result') return;
    resetTimer.current = setTimeout(reset, RESET_MS);
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, [screen, reset]);

  const confirmCheckIn = useCallback(
    async (match: KioskArrivalRow) => {
      if (pending) return;
      setPending(true);
      // The tapped run's first appointment anchors the commit — a later
      // spaced-apart row checks in ITS run, not the next-upcoming one.
      const result = await kioskCheckInByNameAction({
        token,
        patientId: match.patientId,
        appointmentId: match.appointments[0]?.id,
      });
      setScreen({ kind: 'result', result });
      setPending(false);
    },
    [pending, token],
  );

  if (screen.kind === 'grid') {
    return (
      <KioskFrame token={token} locale={locale}>
        <ListView
          rows={rows}
          locale={locale}
          onPick={(match) => setScreen({ kind: 'confirm', match })}
        />
      </KioskFrame>
    );
  }

  if (screen.kind === 'confirm') {
    return (
      <KioskFrame token={token} locale={locale}>
        <ConfirmView
          match={screen.match}
          locale={locale}
          pending={pending}
          onConfirm={() => confirmCheckIn(screen.match)}
          onBack={reset}
        />
      </KioskFrame>
    );
  }

  return (
    <KioskFrame token={token} locale={locale}>
      <ResultView result={screen.result} onDone={reset} />
    </KioskFrame>
  );
}

function ListView({
  rows,
  locale,
  onPick,
}: {
  rows: KioskArrivalRow[] | null;
  locale: string;
  onPick: (match: KioskArrivalRow) => void;
}) {
  const t = useTranslations('kiosk');
  const intlLocale: 'en' | 'ar' = locale === 'ar' ? 'ar' : 'en';

  if (rows === null) {
    return <p className="text-2xl text-brand-textMuted">…</p>;
  }

  if (rows.length === 0) {
    return (
      <div className="flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 text-center">
        <p className="text-4xl font-medium text-brand-navy">{t('welcome')}</p>
        <p className="text-2xl text-brand-textMuted">{t('emptyToday')}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-5 pt-2">
      <p className="text-center text-3xl font-medium text-brand-navy sm:text-4xl">
        {t('tapYourName')}
      </p>
      {/* Scrollable rows, earliest appointment first — must stay usable at
          30–50 patients (Prompt 46 §4 scale requirement carries over). */}
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <ul className="flex flex-col gap-3">
          {rows.map((row) => {
            // Fix 45.1 — ONE typography for every row: the primary slot is
            // always filled (locale name, falling back to the other script
            // when it's missing — the patientDisplayName rule), so an
            // English-only patient renders in the primary style, never as a
            // lonely secondary line. Secondary = the other script only when
            // it exists and differs.
            const { primary, alt } = kioskNamePair(row, locale);
            const first = row.appointments[0];
            const time = first ? formatTime(new Date(first.startsAtIso), intlLocale) : '';
            return (
              // A row key needs the run anchor: the same patient can have two
              // spaced-apart rows on screen at once.
              <li key={`${row.patientId}:${first?.id ?? ''}`}>
                <button
                  type="button"
                  onClick={() => onPick(row)}
                  className="flex min-h-[4.5rem] w-full items-center justify-between gap-4 rounded-2xl border-2 border-brand-border bg-brand-surface px-6 py-4 shadow-sm transition-colors hover:border-brand-cyan active:border-brand-cyan"
                >
                  <span className="flex min-w-0 flex-col items-start gap-0.5 text-start">
                    <span
                      className="truncate text-2xl font-medium leading-tight text-brand-navy"
                      dir="auto"
                    >
                      {primary}
                    </span>
                    {alt ? (
                      <span
                        className="truncate text-base font-normal text-brand-textMuted"
                        dir="auto"
                      >
                        {alt}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-2xl font-medium tabular-nums text-brand-cyan">
                    {time}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function ConfirmView({
  match,
  locale,
  pending,
  onConfirm,
  onBack,
}: {
  match: KioskArrivalRow;
  locale: string;
  pending: boolean;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const t = useTranslations('kiosk');
  // Same Fix 45.1 slot rule as the rows — "هل أنت …؟" must never interpolate
  // an empty name for an English-only patient in /ar.
  const { primary, alt } = kioskNamePair(match, locale);
  const times = match.appointments
    .map((a) => formatTime(new Date(a.startsAtIso), locale === 'ar' ? 'ar' : 'en'))
    .join('، ');

  return (
    <div className="flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-6 text-center">
      <p className="text-4xl font-medium text-brand-navy sm:text-5xl">
        {t('confirmTitle', { name: primary })}
      </p>
      {alt ? (
        <p className="text-2xl font-normal text-brand-textMuted" dir="auto">
          {alt}
        </p>
      ) : null}
      {times ? (
        <p className="text-2xl text-brand-navy">
          {t('confirmAppointments')} <span className="font-medium tabular-nums">{times}</span>
        </p>
      ) : null}
      <div className="flex flex-col items-stretch gap-4 pt-4 sm:flex-row">
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className="rounded-full bg-brand-cyan px-10 py-5 text-2xl font-medium text-white shadow-lg disabled:opacity-50"
        >
          {pending ? '…' : t('confirmYes')}
        </button>
        <button
          type="button"
          onClick={onBack}
          disabled={pending}
          className="rounded-full border-2 border-brand-border bg-brand-surface px-10 py-5 text-2xl font-medium text-brand-navy disabled:opacity-50"
        >
          {t('confirmNo')}
        </button>
      </div>
    </div>
  );
}

function ResultView({ result, onDone }: { result: KioskActionResult; onDone: () => void }) {
  const t = useTranslations('kiosk');

  let tone = 'text-brand-navy';
  let title = '';
  let detail: string | null = null;

  switch (result.kind) {
    case 'CHECKED_IN':
      tone = 'text-brand-teal';
      title = t('checkedIn', { name: result.firstName });
      detail =
        result.appointmentCount > 1
          ? t('checkedInRun', { count: result.appointmentCount })
          : t('turnIn', { minutes: result.delayMinutes });
      break;
    case 'ALREADY_CHECKED_IN':
      tone = 'text-brand-teal';
      title = t('alreadyCheckedIn', { name: result.firstName });
      detail = t('turnIn', { minutes: result.delayMinutes });
      break;
    case 'RATE_LIMITED':
      tone = 'text-brand-navy';
      title = t('rateLimited');
      break;
    case 'INVALID_TOKEN':
    case 'NO_APPOINTMENT':
    default:
      // Generic rejection — never reveals whether the name is registered.
      tone = 'text-brand-navy';
      title = t('noAppointment');
      break;
  }

  return (
    <div className="flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-6 text-center">
      <p className={`text-4xl font-medium sm:text-5xl ${tone}`}>{title}</p>
      {detail && <p className="text-3xl text-brand-navy">{detail}</p>}
      <button
        type="button"
        onClick={onDone}
        className="rounded-full bg-brand-cyan px-8 py-4 text-xl font-medium text-white"
      >
        {t('done')}
      </button>
    </div>
  );
}

function KioskFrame({
  children,
  token,
  locale,
}: {
  children: React.ReactNode;
  token: string;
  locale: string;
}) {
  const t = useTranslations('kiosk');
  const other = locale === 'ar' ? 'en' : 'ar';
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-brand-bg p-6 sm:p-10">
      <header className="flex items-center justify-between">
        <span className="text-lg font-medium text-brand-navy">{t('clinicName')}</span>
        <Link
          href={{ pathname: '/kiosk', query: { token } }}
          locale={other}
          className="rounded-full border border-brand-border bg-brand-surface px-4 py-2 text-base text-brand-navy"
        >
          {other === 'ar' ? 'العربية' : 'English'}
        </Link>
      </header>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center">{children}</div>
    </div>
  );
}
