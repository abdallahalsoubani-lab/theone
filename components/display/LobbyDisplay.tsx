'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

import { minutesOverdue } from '@/lib/appointments/session-timing';
import type { ArrivalRow, ArrivalsBoard } from '@/lib/arrivals/queries';
import { bidiIsolate } from '@/lib/format/bidi';
import { formatTime } from '@/lib/format/date';
import { CLINIC_TIME_ZONE } from '@/lib/format/locale';
import { patientDisplayName } from '@/lib/format/patientName';

const POLL_MS = 10_000;
const STALE_AFTER_MS = 35_000; // ~3 missed polls → show the stale badge

// Clinic wall-clock, not the display device's TZ. The seconds variant has no
// shared-helper equivalent, so it keeps Intl with the zone pinned.
const timeFmt = (locale: string, d: Date, withSeconds = false) =>
  withSeconds
    ? d.toLocaleTimeString(locale === 'ar' ? 'ar-JO' : 'en-GB', {
        timeZone: CLINIC_TIME_ZONE,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : formatTime(d, locale === 'ar' ? 'ar' : 'en');

/**
 * Staff break-room lobby display (Prompt 18 §4). Standalone, TV-friendly,
 * runs all day with no interaction. Polls the token-gated data feed every
 * ~10s and survives network blips (keeps the last good board, shows a "stale"
 * badge until the next success). Names only — no phone numbers.
 */
export function LobbyDisplay({ token, locale }: { token: string; locale: string }) {
  const t = useTranslations('display');
  const tStatus = useTranslations('appointments.status');
  const [board, setBoard] = useState<ArrivalsBoard | null>(null);
  const [stale, setStale] = useState(false);
  const [clock, setClock] = useState('');
  const [lastUpdated, setLastUpdated] = useState('');
  const lastOk = useRef<number>(0);

  const poll = useCallback(async () => {
    try {
      // Per-poll cache-buster (`_=<ms>`): a unique URL each cycle defeats any
      // URL-keyed browser/proxy/CDN cache, so the screen always sees live state.
      const res = await fetch(
        `/api/v1/arrivals/display?token=${encodeURIComponent(token)}&_=${Date.now()}`,
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error(String(res.status));
      const data: ArrivalsBoard = await res.json();
      setBoard(data);
      lastOk.current = Date.now();
      setLastUpdated(timeFmt(locale, new Date(), true));
      setStale(false);
    } catch {
      // Keep the last good board; mark stale once polls have been failing.
      if (lastOk.current && Date.now() - lastOk.current > STALE_AFTER_MS) setStale(true);
    }
  }, [token, locale]);

  useEffect(() => {
    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  // Live wall clock, updated each second.
  useEffect(() => {
    const tick = () => setClock(formatTime(new Date(), locale === 'ar' ? 'ar' : 'en'));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [locale]);

  const name = (r: ArrivalRow) => patientDisplayName(r.patientNameEn, r.patientNameAr, locale);
  const therapist = (r: ArrivalRow) => (locale === 'ar' ? r.therapistNameAr : r.therapistNameEn);
  const time = (iso: string) => formatTime(new Date(iso), locale === 'ar' ? 'ar' : 'en');
  const waitMinutes = (iso: string) =>
    Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));

  return (
    <div className="fixed inset-0 z-50 flex flex-col gap-6 overflow-hidden bg-waiting-cream p-8 text-brand-navy">
      <header className="flex items-center justify-between border-b-4 border-waiting-green pb-4">
        <h1 className="text-3xl font-semibold">{t('title')}</h1>
        <div className="flex items-center gap-4">
          {stale && (
            <span className="rounded-full bg-amber-500/90 px-4 py-1 text-lg font-medium text-brand-navy">
              {t('stale')}
            </span>
          )}
          <div className="text-end">
            <span className="block text-4xl font-medium tabular-nums">{clock}</span>
            {lastUpdated && (
              <span className="block text-sm text-brand-navy/50">
                {t('lastUpdated', { time: lastUpdated })}
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 gap-6 overflow-hidden lg:grid-cols-3">
        <Section
          title={t('waitingNow')}
          accent="green"
          empty={!board?.waiting.length}
          emptyLabel={t('noneWaiting')}
        >
          {board?.waiting.map((r) => (
            <Row
              key={r.appointmentId}
              primary={name(r)}
              secondary={`${bidiIsolate(therapist(r))} · ${time(r.startsAt)}`}
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
          {board?.inSession.map((r) => {
            // PT-B3 item 1 — a session running past its slot is flagged, never
            // closed automatically. Recomputed on every 10s poll render.
            const over = minutesOverdue(new Date(), new Date(r.startsAt), r.durationMinutes);
            return (
              <Row
                key={r.appointmentId}
                primary={name(r)}
                secondary={therapist(r)}
                badge={over > 0 ? tStatus('overdue', { minutes: over }) : undefined}
                badgeTone={over > 0 ? 'amber' : 'default'}
              />
            );
          })}
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
              secondary={`${bidiIsolate(therapist(r))}${r.roomName ? ` · ${bidiIsolate(r.roomName)}` : ''}`}
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
  accent: 'green' | 'teal' | 'muted';
  empty?: boolean;
  emptyLabel: string;
  children: React.ReactNode;
}) {
  const bar =
    accent === 'green'
      ? 'bg-waiting-green'
      : accent === 'teal'
        ? 'bg-brand-teal'
        : 'bg-brand-navy/30';
  return (
    <section className="flex min-h-0 flex-col rounded-2xl bg-white shadow-sm ring-1 ring-brand-navy/5">
      <h2 className="flex items-center gap-3 px-5 py-4 text-2xl font-semibold">
        <span className={`inline-block h-6 w-2 rounded-full ${bar}`} />
        {title}
      </h2>
      <ul className="flex-1 space-y-2 overflow-y-auto px-5 pb-5">
        {empty ? <li className="text-xl text-brand-navy/40">{emptyLabel}</li> : children}
      </ul>
    </section>
  );
}

function Row({
  primary,
  secondary,
  badge,
  badgeTone = 'default',
}: {
  primary: string;
  secondary: string;
  badge?: string;
  /** 'amber' marks an over-running session (PT-B3 item 1) — the text says so
   *  too, so the tint is reinforcement, never the only signal. */
  badgeTone?: 'default' | 'amber';
}) {
  return (
    <li className="flex items-center justify-between gap-4 rounded-xl bg-waiting-green/10 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-2xl font-semibold">{primary}</p>
        <p className="truncate text-lg text-brand-navy/60">{secondary}</p>
      </div>
      {badge && (
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-lg font-medium tabular-nums ${
            badgeTone === 'amber'
              ? 'bg-amber-500/20 text-amber-800 ring-1 ring-inset ring-amber-500/40'
              : 'bg-waiting-green text-brand-navy'
          }`}
        >
          {badge}
        </span>
      )}
    </li>
  );
}
