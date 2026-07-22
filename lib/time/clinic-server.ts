/**
 * DB-backed clinic timezone accessor (Prompt 31 §4.1). Server/worker only —
 * client components use the CLINIC_TIME_ZONE constant default baked into
 * lib/time/clinic.ts.
 *
 * The zone is admin-pinned reference data that effectively never changes, so
 * a short-TTL module cache keeps hot paths (WhatsApp fan-outs, workers) from
 * re-querying per message.
 */

import { db } from '@/lib/db';
import { CLINIC_TIME_ZONE } from '@/lib/time/clinic';

const TTL_MS = 5 * 60_000;

let cached: { timeZone: string; at: number } | null = null;

export async function getClinicTimeZone(): Promise<string> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.timeZone;
  const row = await db.clinicSettings.findUnique({
    where: { id: 'default' },
    select: { timezone: true },
  });
  const timeZone = row?.timezone ?? CLINIC_TIME_ZONE;
  cached = { timeZone, at: Date.now() };
  return timeZone;
}

/** Test seam — drop the cache so a test can swap the mocked settings row. */
export function __resetClinicTimeZoneCache(): void {
  cached = null;
}
