import { parseClinicDateTimeLocal } from '@/lib/time/clinic';

import { DAY_KEYS, type DayKey } from './conflicts-time';
import { RESIZE_MIN_MINUTES, type BatchRowType } from './schemas';

/**
 * Client-side row validation for the multi-appointment batch modal
 * (July 31 item 4). Pure functions — the modal runs these on every edit for
 * instant per-row feedback. They are UX, not the guarantee: the server
 * re-validates through the Zod schema (shape / duplicates / overlap) and
 * the service + conflict engine (past start, closed day, real conflicts).
 */

/** A row as the modal holds it — date + time as picker strings. */
export interface BatchRowDraft {
  date: string; // YYYY-MM-DD (clinic-wall)
  time: string; // HH:mm (clinic-wall)
  /** Prompt 51 — per-row booking type (SESSION | STRETCHING). */
  appointmentType: BatchRowType;
  therapistIds: string[];
  roomId: string;
  durationMinutes: number;
}

export type BatchRowIssue =
  | 'incomplete'
  | 'stretchingNoTherapist'
  | 'durationTooShort'
  | 'pastDate'
  | 'closedDay'
  | 'duplicateRow'
  | 'overlappingRows';

/** Weekday key of a YYYY-MM-DD calendar date (date-only → weekday is
 *  timezone-independent; noon-UTC parse avoids any midnight edge). */
export function dayKeyOfDate(date: string): DayKey | null {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return DAY_KEYS[parsed.getUTCDay()] ?? null;
}

/** The row's concrete instant, or null while date/time are incomplete. */
export function rowInstant(row: Pick<BatchRowDraft, 'date' | 'time'>): Date | null {
  if (!row.date || !row.time) return null;
  return parseClinicDateTimeLocal(`${row.date}T${row.time}`);
}

/**
 * Validate the full draft list. Returns one issue list per row (same order).
 * Rules mirror §3.2: completeness, duration floor, past start, closed
 * weekday, exact duplicates, and duration-aware same-patient overlap inside
 * the batch. Later rows carry the duplicate/overlap flag so the earlier row
 * stays green.
 */
export function validateBatchRows(
  rows: BatchRowDraft[],
  opts: { closedDays: ReadonlyArray<DayKey>; now?: Date },
): BatchRowIssue[][] {
  const now = opts.now ?? new Date();
  const closed = new Set(opts.closedDays);
  const issues: BatchRowIssue[][] = rows.map(() => []);

  const instants = rows.map((row) => {
    return rowInstant(row);
  });

  rows.forEach((row, i) => {
    // Prompt 51 — per-row type rule, same as the single modal: a SESSION
    // needs ≥1 therapist; a STRETCHING row has none (room + beds).
    const stretching = row.appointmentType === 'STRETCHING';
    const complete = Boolean(
      row.date &&
      row.time &&
      row.roomId &&
      (stretching || row.therapistIds.length > 0) &&
      row.durationMinutes,
    );
    if (!complete) {
      issues[i]!.push('incomplete');
      return;
    }
    if (stretching && row.therapistIds.length > 0) issues[i]!.push('stretchingNoTherapist');
    if (row.durationMinutes < RESIZE_MIN_MINUTES) issues[i]!.push('durationTooShort');
    const dayKey = dayKeyOfDate(row.date);
    if (dayKey && closed.has(dayKey)) issues[i]!.push('closedDay');
    const instant = instants[i];
    if (instant && instant.getTime() < now.getTime()) issues[i]!.push('pastDate');
  });

  // Duplicates + overlaps only among complete rows with a valid instant.
  const seen = new Map<string, number>();
  for (let i = 0; i < rows.length; i++) {
    if (issues[i]!.includes('incomplete') || !instants[i]) continue;
    const row = rows[i]!;
    const key = `${instants[i]!.getTime()}|${row.roomId}|${[...new Set(row.therapistIds)].sort().join(',')}`;
    if (seen.has(key)) issues[i]!.push('duplicateRow');
    else seen.set(key, i);
  }
  for (let i = 0; i < rows.length; i++) {
    if (issues[i]!.includes('incomplete') || !instants[i]) continue;
    for (let j = i + 1; j < rows.length; j++) {
      if (issues[j]!.includes('incomplete') || !instants[j]) continue;
      const aStart = instants[i]!.getTime();
      const aEnd = aStart + rows[i]!.durationMinutes * 60_000;
      const bStart = instants[j]!.getTime();
      const bEnd = bStart + rows[j]!.durationMinutes * 60_000;
      if (aStart < bEnd && bStart < aEnd && !issues[j]!.includes('duplicateRow')) {
        if (!issues[j]!.includes('overlappingRows')) issues[j]!.push('overlappingRows');
      }
    }
  }

  return issues;
}
