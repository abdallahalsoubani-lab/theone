/**
 * Back-to-back arrival grouping (July change request #3).
 *
 * A patient with several of today's appointments checks in ONCE for a run of
 * *exactly adjacent* appointments (each starts the instant the previous one
 * ends — zero gap), and separately for appointments that are spaced apart.
 *
 * This is the single source of truth for that decision: it governs both how
 * many arrivals a kiosk check-in records now AND how many WhatsApp messages
 * fire later (item 2, deferred). Kept pure so it is fully unit-tested.
 *
 * "Back-to-back" is exact adjacency: `next.startsAt === prev.startsAt +
 * prev.durationMinutes`. Any positive gap starts a new run; an overlap or a
 * duplicate start time is NOT adjacency and also starts a new run (only a
 * clean zero-gap hand-off chains).
 */
export interface GroupableAppointment {
  id: string;
  startsAt: Date;
  durationMinutes: number;
}

export function groupAdjacentAppointments<T extends GroupableAppointment>(appts: T[]): T[][] {
  // Sort a copy by start time so callers can pass any order.
  const sorted = [...appts].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const runs: T[][] = [];

  for (const appt of sorted) {
    const currentRun = runs[runs.length - 1];
    if (currentRun) {
      const prev = currentRun[currentRun.length - 1]!;
      const prevEnd = prev.startsAt.getTime() + prev.durationMinutes * 60_000;
      // Chain ONLY on an exact zero-gap hand-off. Gap > 0, overlap, or a
      // duplicate start all break the run.
      if (appt.startsAt.getTime() === prevEnd) {
        currentRun.push(appt);
        continue;
      }
    }
    runs.push([appt]);
  }

  return runs;
}
