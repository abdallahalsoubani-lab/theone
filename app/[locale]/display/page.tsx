import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { LobbyDisplay } from '@/components/display/LobbyDisplay';
import { validateArrivalsToken } from '@/lib/arrivals/tokens';

/**
 * Standalone staff lobby display (Prompt 18 §4). Token-gated (display token,
 * separate from the kiosk). Public path; no staff session. The live data is
 * fetched client-side from the token-gated `/api/v1/arrivals/display` feed.
 */
export const dynamic = 'force-dynamic';

export default async function DisplayPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const token = typeof sp.token === 'string' ? sp.token : undefined;

  if (!(await validateArrivalsToken('display', token))) {
    notFound();
  }

  return <LobbyDisplay token={token!} locale={locale} />;
}
