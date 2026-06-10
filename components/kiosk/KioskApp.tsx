'use client';

import { Delete } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Link } from '@/i18n/navigation';
import { kioskCheckInAction, type KioskActionResult } from '@/lib/arrivals/actions';

type Screen = { kind: 'idle' } | { kind: 'entry' } | { kind: 'result'; result: KioskActionResult };

const RESET_MS = 8000;
const MAX_DIGITS = 12;

/**
 * Public check-in kiosk (Prompt 18 §1). Idle → numeric keypad → result, then
 * auto-resets to idle. No staff session; the device token is passed in via the
 * URL and forwarded to the rate-limited server action. Big touch targets,
 * RTL-aware via the surrounding locale layout.
 */
export function KioskApp({ token, locale }: { token: string; locale: string }) {
  const t = useTranslations('kiosk');
  const [screen, setScreen] = useState<Screen>({ kind: 'idle' });
  const [digits, setDigits] = useState('');
  const [pending, setPending] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    setDigits('');
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

  const submit = useCallback(async () => {
    if (pending || digits.length < 9) return;
    setPending(true);
    const result = await kioskCheckInAction({ token, phone: digits });
    setScreen({ kind: 'result', result });
    setPending(false);
  }, [digits, pending, token]);

  if (screen.kind === 'idle') {
    return (
      <KioskFrame token={token} locale={locale}>
        <button
          type="button"
          onClick={() => setScreen({ kind: 'entry' })}
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

  if (screen.kind === 'result') {
    return (
      <KioskFrame token={token} locale={locale}>
        <ResultView result={screen.result} onDone={reset} />
      </KioskFrame>
    );
  }

  return (
    <KioskFrame token={token} locale={locale}>
      <div className="flex w-full max-w-md flex-1 flex-col items-center justify-center gap-6">
        <p className="text-2xl font-medium text-brand-navy">{t('enterPhone')}</p>
        <div
          dir="ltr"
          className="flex h-16 w-full items-center justify-center rounded-2xl border-2 border-brand-border bg-brand-surface text-3xl tracking-widest text-brand-navy"
          aria-live="polite"
        >
          {digits || <span className="text-brand-textMuted">07••••••••</span>}
        </div>
        <div className="grid w-full grid-cols-3 gap-3">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => (
            <Key key={n} onClick={() => setDigits((d) => (d.length < MAX_DIGITS ? d + n : d))}>
              {n}
            </Key>
          ))}
          <Key onClick={() => setDigits((d) => d.slice(0, -1))} aria-label={t('delete')}>
            <Delete className="mx-auto size-7" />
          </Key>
          <Key onClick={() => setDigits((d) => (d.length < MAX_DIGITS ? d + '0' : d))}>0</Key>
          <Key
            onClick={submit}
            disabled={pending || digits.length < 9}
            tone="primary"
            aria-label={t('submit')}
          >
            {pending ? '…' : '✓'}
          </Key>
        </div>
        <button
          type="button"
          onClick={reset}
          className="text-lg text-brand-textMuted underline-offset-4 hover:underline"
        >
          {t('cancel')}
        </button>
      </div>
    </KioskFrame>
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
      detail = t('turnIn', { minutes: result.delayMinutes });
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
      // Generic rejection — never reveals whether the phone is registered.
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

function Key({
  children,
  onClick,
  disabled,
  tone,
  ...rest
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'primary';
  'aria-label'?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`h-20 rounded-2xl text-3xl font-medium transition-colors disabled:opacity-40 ${
        tone === 'primary'
          ? 'bg-brand-cyan text-white hover:bg-brand-cyan/90'
          : 'border-2 border-brand-border bg-brand-surface text-brand-navy hover:bg-brand-bg'
      }`}
      {...rest}
    >
      {children}
    </button>
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
