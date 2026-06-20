import { db } from '@/lib/db';

/**
 * Session-lifecycle grace windows (Fix Prompt 2), read from clinic settings.
 *
 * Kept in its own db-only module (no queue/auth imports) so both the
 * Start-Session gate in `services.ts` and the overdue auto-complete worker
 * share one reader without dragging the heavy service graph into the worker /
 * its unit tests.
 */
export async function getSessionGraceConfig(): Promise<{
  startGraceMinutes: number;
  autoCompleteGraceMinutes: number;
  timeZone: string;
}> {
  const settings = await db.clinicSettings.findUnique({
    where: { id: 'default' },
    select: {
      sessionStartGraceMinutes: true,
      sessionAutoCompleteGraceMinutes: true,
      timezone: true,
    },
  });
  return {
    startGraceMinutes: settings?.sessionStartGraceMinutes ?? 15,
    autoCompleteGraceMinutes: settings?.sessionAutoCompleteGraceMinutes ?? 15,
    timeZone: settings?.timezone ?? 'Asia/Amman',
  };
}
