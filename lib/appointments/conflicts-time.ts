/**
 * Shared time-key constants for the scheduling layer. Extracted from
 * `conflicts.ts` so the pure recurrence engine can depend on them
 * without pulling in Prisma + DB modules.
 */

export type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';

export const DAY_KEYS: ReadonlyArray<DayKey> = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
