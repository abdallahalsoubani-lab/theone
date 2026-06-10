import { NextResponse, type NextRequest } from 'next/server';

import { getArrivalsBoard } from '@/lib/arrivals/queries';
import { validateArrivalsToken } from '@/lib/arrivals/tokens';

/**
 * Lobby-display data feed (Prompt 18 §4). Polled every ~12s by the standalone
 * display screen. Token-gated (the display token, a separate trust zone from
 * the kiosk). The payload carries patient NAMES only — no phone numbers and no
 * clinical detail (asserted phone-free in tests).
 */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!(await validateArrivalsToken('display', token))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const board = await getArrivalsBoard();
  return NextResponse.json(board, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
