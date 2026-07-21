'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Link } from '@/i18n/navigation';
import {
  kioskCheckInByNameAction,
  kioskSearchAction,
  type KioskActionResult,
} from '@/lib/arrivals/actions';
import type { KioskSearchMatch } from '@/lib/arrivals/kiosk';
import { formatTime } from '@/lib/format/date';

type Screen =
  | { kind: 'idle' }
  | { kind: 'search' }
  | { kind: 'confirm'; match: KioskSearchMatch }
  | { kind: 'result'; result: KioskActionResult };

const RESET_MS = 8000;
const SEARCH_DEBOUNCE_MS = 350;
const MIN_QUERY = 2;

/**
 * Public check-in kiosk (Prompt 18 §1; reworked July #1/#3). Check-in is by
 * NAME with a mandatory confirm step: idle → name search → confirm → result,
 * then auto-resets to idle. PRIVACY: the idle screen never shows a patient
 * list; names appear only as filtered matches after the patient types. No
 * staff session; the device token is forwarded to the rate-limited actions.
 */
export function KioskApp({ token, locale }: { token: string; locale: string }) {
  const t = useTranslations('kiosk');
  const [screen, setScreen] = useState<Screen>({ kind: 'idle' });
  const [pending, setPending] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    setPending(false);
    setScreen({ kind: 'idle' });
  }, []);

  // Auto-return to idle a few seconds after showing a result.
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

  if (screen.kind === 'idle') {
    return (
      <KioskFrame token={token} locale={locale}>
        <button
          type="button"
          onClick={() => setScreen({ kind: 'search' })}
          className="flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-6 rounded-3xl text-center"
        >
          <span className="text-5xl font-medium text-brand-navy sm:text-6xl">{t('welcome')}</span>
          <span className="rounded-full bg-brand-cyan px-10 py-5 text-2xl font-medium text-white shadow-lg">
            {t('tapToStart')}
          </span>
        </button>
      </KioskFrame>
    );
  }

  if (screen.kind === 'search') {
    return (
      <KioskFrame token={token} locale={locale}>
        <SearchView
          token={token}
          locale={locale}
          onPick={(match) => setScreen({ kind: 'confirm', match })}
          onCancel={reset}
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
          onBack={() => setScreen({ kind: 'search' })}
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

function SearchView({
  token,
  locale,
  onPick,
  onCancel,
}: {
  token: string;
  locale: string;
  onPick: (match: KioskSearchMatch) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('kiosk');
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<KioskSearchMatch[]>([]);
  const [searching, setSearching] = useState(false);
  // Monotonic request id: only the latest search's results are applied, so a
  // slow earlier response can never overwrite a newer one.
  const reqId = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY) {
      setMatches([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const id = ++reqId.current;
    const timer = setTimeout(async () => {
      const res = await kioskSearchAction({ token, query: q });
      if (id !== reqId.current) return; // a newer search superseded this one
      setMatches(res.kind === 'MATCHES' ? res.matches : []);
      setSearching(false);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, token]);

  const nameFor = (m: KioskSearchMatch) => (locale === 'ar' ? m.fullNameAr : m.fullNameEn);
  const altName = (m: KioskSearchMatch) => (locale === 'ar' ? m.fullNameEn : m.fullNameAr);

  return (
    <div className="flex w-full max-w-xl flex-1 flex-col items-center gap-6 pt-8">
      <p className="text-3xl font-medium text-brand-navy">{t('typeName')}</p>
      <input
        // Kiosk: focus the field so the on-screen keyboard opens immediately.
        autoFocus
        type="text"
        inputMode="text"
        autoComplete="off"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('searchPlaceholder')}
        className="h-16 w-full rounded-2xl border-2 border-brand-border bg-brand-surface px-6 text-3xl text-brand-navy outline-none focus:border-brand-cyan"
      />
      <div className="min-h-[3rem] w-full" aria-live="polite">
        {query.trim().length < MIN_QUERY ? (
          <p className="text-center text-xl text-brand-textMuted">{t('searchHint')}</p>
        ) : matches.length === 0 ? (
          <p className="text-center text-xl text-brand-textMuted">
            {searching ? '…' : t('noAppointment')}
          </p>
        ) : (
          <ul className="flex w-full flex-col gap-3">
            {matches.map((m) => (
              <li key={m.patientId}>
                <button
                  type="button"
                  onClick={() => onPick(m)}
                  className="flex w-full flex-col items-start gap-0.5 rounded-2xl border-2 border-brand-border bg-brand-surface px-6 py-4 text-start hover:border-brand-cyan"
                >
                  <span className="text-2xl font-medium text-brand-navy">{nameFor(m)}</span>
                  <span className="text-lg text-brand-textMuted" dir="auto">
                    {altName(m)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="mt-auto pb-4 text-lg text-brand-textMuted underline-offset-4 hover:underline"
      >
        {t('cancel')}
      </button>
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
  match: KioskSearchMatch;
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
  const locale = useLocale();

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
    case 'APPOINTMENT_PASSED':
      // Arrival recorded, but the slot already ended — never promise a
      // future "your turn in ~X minutes" (Prompt 22 §4.3).
      tone = 'text-brand-navy';
      title = t('checkedIn', { name: result.firstName });
      detail = t('appointmentPassed', {
        time: formatTime(new Date(result.startsAtIso), locale === 'ar' ? 'ar' : 'en'),
      });
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
      <div className="flex flex-1 flex-col items-center justify-center">{children}</div>
    </div>
  );
}
