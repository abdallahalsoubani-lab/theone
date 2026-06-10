'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ArrivalRow, ArrivalsBoard } from '@/lib/arrivals/queries';

const POLL_MS = 12_000;
const STALE_AFTER_MS = 40_000; // ~3 missed polls → show the stale badge

/**
 * Staff break-room lobby display (Prompt 18 §4). Standalone, TV-friendly,
 * runs all day with no interaction. Polls the token-gated data feed every
 * ~12s and survives network blips (keeps the last good board, shows a "stale"
 * badge until the next success). Names only — no phone numbers.
 */
export function LobbyDisplay({ token, locale }: { token: string; locale: string }) {
  const t = useTranslations('display');
  const [board, setBoard] = useState<ArrivalsBoard | null>(null);
  const [stale, setStale] = useState(false);
  const [clock, setClock] = useState('');
  const lastOk = useRef<number>(0);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/arrivals/display?token=${encodeURIComponent(token)}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(String(res.status));
      const data: ArrivalsBoard = await res.json();
      setBoard(data);
      lastOk.current = Date.now();
      setStale(false);
    } catch {
      // Keep the last good board; mark stale once polls have been failing.
      if (lastOk.current && Date.now() - lastOk.current > STALE_AFTER_MS) setStale(true);
    }
  }, [token]);

  useEffect(() => {
    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  // Live wall clock, updated each second.
  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString(locale === 'ar' ? 'ar-JO' : 'en-GB', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [locale]);

  const name = (r: ArrivalRow) => (locale === 'ar' ? r.patientNameAr : r.patientNameEn);
  const therapist = (r: ArrivalRow) => (locale === 'ar' ? r.therapistNameAr : r.therapistNameEn);
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale === 'ar' ? 'ar-JO' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });
  const waitMinutes = (iso: string) =>
    Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));

  return (
    <div className="fixed inset-0 z-50 flex flex-col gap-6 overflow-hidden bg-brand-navy p-8 text-white">
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-medium">{t('title')}</h1>
        <div className="flex items-center gap-4">
          {stale && (
            <span className="rounded-full bg-amber-500/90 px-4 py-1 text-lg font-medium text-brand-navy">
              {t('stale')}
            </span>
          )}
          <span className="text-4xl font-medium tabular-nums">{clock}</span>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 gap-6 overflow-hidden lg:grid-cols-3">
        <Section
          title={t('waitingNow')}
          accent="cyan"
          empty={!board?.waiting.length}
          emptyLabel={t('noneWaiting')}
        >
          {board?.waiting.map((r) => (
            <Row
              key={r.appointmentId}
              primary={name(r)}
              secondary={`${therapist(r)} · ${time(r.startsAt)}`}
              badge={t('waitingMinutes', {
                minutes: r.checkedInAt ? waitMinutes(r.checkedInAt) : 0,
              })}
            />
          ))}
        </Section>

        <Section
          title={t('inSession')}
          accent="teal"
          empty={!board?.inSession.length}
          emptyLabel={t('noneInSession')}
        >
          {board?.inSession.map((r) => (
            <Row key={r.appointmentId} primary={name(r)} secondary={therapist(r)} />
          ))}
        </Section>

        <Section
          title={t('upNext')}
          accent="muted"
          empty={!board?.upNext.length}
          emptyLabel={t('noneUpNext')}
        >
          {board?.upNext.map((r) => (
            <Row
              key={r.appointmentId}
              primary={name(r)}
              secondary={`${therapist(r)}${r.roomName ? ` · ${r.roomName}` : ''}`}
              badge={time(r.startsAt)}
            />
          ))}
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  accent,
  empty,
  emptyLabel,
  children,
}: {
  title: string;
  accent: 'cyan' | 'teal' | 'muted';
  empty?: boolean;
  emptyLabel: string;
  children: React.ReactNode;
}) {
  const bar =
    accent === 'cyan' ? 'bg-brand-cyan' : accent === 'teal' ? 'bg-brand-teal' : 'bg-white/40';
  return (
    <section className="flex min-h-0 flex-col rounded-2xl bg-white/5">
      <h2 className="flex items-center gap-3 px-5 py-4 text-2xl font-medium">
        <span className={`inline-block h-6 w-2 rounded-full ${bar}`} />
        {title}
      </h2>
      <ul className="flex-1 space-y-2 overflow-y-auto px-5 pb-5">
        {empty ? <li className="text-xl text-white/50">{emptyLabel}</li> : children}
      </ul>
    </section>
  );
}

function Row({
  primary,
  secondary,
  badge,
}: {
  primary: string;
  secondary: string;
  badge?: string;
}) {
  return (
    <li className="flex items-center justify-between gap-4 rounded-xl bg-white/10 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-2xl font-medium">{primary}</p>
        <p className="truncate text-lg text-white/70">{secondary}</p>
      </div>
      {badge && (
        <span className="shrink-0 rounded-full bg-white/15 px-3 py-1 text-lg tabular-nums">
          {badge}
        </span>
      )}
    </li>
  );
}
