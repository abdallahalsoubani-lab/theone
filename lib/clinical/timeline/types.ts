export type TimelineEntryKind =
  | 'INTAKE'
  | 'APPOINTMENT'
  | 'PLAN_CREATED'
  | 'PLAN_PROPOSED'
  | 'PLAN_APPROVED'
  | 'PLAN_REJECTED'
  | 'PLAN_PAUSED'
  | 'PLAN_COMPLETED'
  | 'PLAN_DISCONTINUED'
  | 'PLAN_SUPERSEDED'
  | 'SESSION_NOTE'
  | 'SESSION_NOTE_ADDENDUM'
  | 'DAY_REPORT'
  | 'DOCTOR_REVIEW';

export interface TimelineEntry {
  id: string;
  kind: TimelineEntryKind;
  occurredAt: Date;
  /** Short title shown on the timeline card. */
  title: string;
  /** Optional body — usually a snippet of the underlying content. */
  body?: string;
  /** Author name (Therapist / Doctor / actor) when known. */
  author?: string;
  /** Stable link into the relevant source page (read-only timeline. */
  linkPath?: string;
  /** Underlying entity id — useful for filter chips + dedupe. */
  sourceId: string;
}

export interface TimelineFilters {
  kinds?: TimelineEntryKind[];
  from?: Date;
  to?: Date;
  search?: string;
}

export interface TimelinePage {
  entries: TimelineEntry[];
  /** Total count across all sources after filtering — for pagination. */
  total: number;
}
