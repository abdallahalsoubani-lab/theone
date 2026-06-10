import { NextResponse, type NextRequest } from 'next/server';

import { getArrivalsBoard } from '@/lib/arrivals/queries';
import { validateArrivalsToken } from '@/lib/arrivals/tokens';

/**
 * Lobby-display data feed (Prompt 18 §4). Polled every ~10s by the standalone
 * display screen. Token-gated (the display token, a separate trust zone from
 * the kiosk). The payload carries patient NAMES only — no phone numbers and no
 * clinical detail (asserted phone-free in tests).
 *
 * Caching is deliberately disabled at every layer so each poll reflects live
 * check-in state: `force-dynamic` + `revalidate = 0` + `fetchCache` keep Next
 * from caching the route or its reads, and the response headers below tell any
 * browser / reverse-proxy / CDN in front never to serve a stored copy. The
 * client also appends a per-poll cache-buster, which defeats URL-keyed caches
 * even if a misconfigured proxy ignores these headers.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const NO_STORE = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
} as const;

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!(await validateArrivalsToken('display', token))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: NO_STORE });
  }
  const board = await getArrivalsBoard();
  return NextResponse.json(board, { headers: NO_STORE });
}
