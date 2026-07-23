'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Link } from '@/i18n/navigation';
import {
  kioskCheckInByNameAction,
  kioskTodayAction,
  type KioskActionResult,
} from '@/lib/arrivals/actions';
import type { KioskPatientCard } from '@/lib/arrivals/kiosk';
import { formatTime } from '@/lib/format/date';

type Screen =
  | { kind: 'grid' }
  | { kind: 'confirm'; match: KioskPatientCard }
  | { kind: 'result'; result: KioskActionResult };

const RESET_MS = 8000;
/** Grid auto-refresh so the day's list stays current untouched (Prompt 46). */
const REFRESH_MS = 60_000;

/**
 * Public check-in kiosk (Prompt 18 §1; July #1/#3; cards grid in Prompt 46).
 *
 * Today's arrivable patients render as large tappable cards — the patient
 * taps their name instead of typing it (owner ruling; the Prompt 27 §2
 * privacy stance was explicitly reversed — full names on the entrance
 * screen). Tap → mandatory confirm ("are you {name}?") → check-in with the
 * back-to-back grouping untouched → result → auto-reset. Already-checked-in
 * patients stay on the grid in a ✓ state. No staff session; the device token
 * is forwarded to the rate-limited actions.
 */
export function KioskApp({ token, locale }: { token: string; locale: string }) {
  const [screen, setScreen] = useState<Screen>({ kind: 'grid' });
  const [patients, setPatients] = useState<KioskPatientCard[] | null>(null);
  const [pending, setPending] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    const res = await kioskTodayAction({ token });
    // Rate-limit / token hiccups keep the last good list on screen.
    if (res.kind === 'PATIENTS') setPatients(res.patients);
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
    async (patientId: string) => {
      if (pending) return;
      setPending(true);
      const result = await kioskCheckInByNameAction({ token, patientId });
      setScreen({ kind: 'result', result });
      setPending(false);
    },
    [pending, token],
  );

  if (screen.kind === 'grid') {
    return (
      <KioskFrame token={token} locale={locale}>
        <GridView
          patients={patients}
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
          onConfirm={() => confirmCheckIn(screen.match.patientId)}
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

function GridView({
  patients,
  locale,
  onPick,
}: {
  patients: KioskPatientCard[] | null;
  locale: string;
  onPick: (match: KioskPatientCard) => void;
}) {
  const t = useTranslations('kiosk');
  const intlLocale: 'en' | 'ar' = locale === 'ar' ? 'ar' : 'en';

  if (patients === null) {
    return <p className="text-2xl text-brand-textMuted">…</p>;
  }

  if (patients.length === 0) {
    return (
      <div className="flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 text-center">
        <p className="text-4xl font-medium text-brand-navy">{t('welcome')}</p>
        <p className="text-2xl text-brand-textMuted">{t('emptyToday')}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-5 pt-2">
      <p className="text-center text-3xl font-medium text-brand-navy sm:text-4xl">
        {t('tapYourName')}
      </p>
      {/* Scrollable grid — must stay usable at 30–50 patients (Prompt 46 §4). */}
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <ul className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {patients.map((p) => {
            const primary = locale === 'ar' ? p.fullNameAr : p.fullNameEn;
            const alt = locale === 'ar' ? p.fullNameEn : p.fullNameAr;
            const next = p.appointments[0]
              ? formatTime(new Date(p.appointments[0].startsAtIso), intlLocale)
              : '';
            return (
              <li key={p.patientId}>
                <button
                  type="button"
                  onClick={() => onPick(p)}
                  className={`flex min-h-[7.5rem] w-full flex-col items-center justify-center gap-1.5 rounded-2xl border-2 px-4 py-5 text-center shadow-sm transition-colors ${
                    p.checkedIn
                      ? 'border-brand-teal/60 bg-brand-teal/10'
                      : 'border-brand-border bg-brand-surface hover:border-brand-cyan active:border-brand-cyan'
                  }`}
                >
                  <span className="text-2xl font-medium leading-tight text-brand-navy">
                    {primary}
                  </span>
                  {alt && alt !== primary ? (
                    <span className="text-base text-brand-textMuted" dir="auto">
                      {alt}
                    </span>
                  ) : null}
                  {p.checkedIn ? (
                    <span className="mt-1 rounded-full bg-brand-teal px-3 py-1 text-sm font-medium text-white">
                      ✓ {t('cardCheckedIn')}
                    </span>
                  ) : (
                    <span className="mt-1 text-lg tabular-nums text-brand-cyan">{next}</span>
                  )}
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
  match: KioskPatientCard;
  locale: string;
  pending: boolean;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const t = useTranslations('kiosk');
  const primary = locale === 'ar' ? match.fullNameAr : match.fullNameEn;
  const alt = locale === 'ar' ? match.fullNameEn : match.fullNameAr;
  const times = match.appointments
    .map((a) => formatTime(new Date(a.startsAtIso), locale === 'ar' ? 'ar' : 'en'))
    .join('، ');

  return (
    <div className="flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-6 text-center">
      <p className="text-4xl font-medium text-brand-navy sm:text-5xl">
        {t('confirmTitle', { name: primary })}
      </p>
      {alt && alt !== primary ? <p className="text-2xl text-brand-textMuted">{alt}</p> : null}
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
