/**
 * Calendar appearance — per-therapist tints + status colors for the custom
 * calendar (Custom Calendar Phase 1). Pure (returns inline-style values); no
 * React. Mirrors the palette + status semantics the react-big-calendar theme
 * used (calendar.css) so the custom view matches the existing look. Data-viz
 * tints sit alongside the brand palette, not replacing it (Master Context §4.1).
 */

export type AppointmentStatus =
  | 'SCHEDULED'
  | 'CONFIRMED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

export interface Tint {
  bg: string;
  border: string;
  swatch: string;
}

const THERAPIST_TINTS: ReadonlyArray<Tint> = [
  { bg: 'rgba(27, 73, 130, 0.12)', border: 'rgba(27, 73, 130, 0.55)', swatch: '#1b4982' },
  { bg: 'rgba(61, 192, 217, 0.16)', border: 'rgba(61, 192, 217, 0.60)', swatch: '#3dc0d9' },
  { bg: 'rgba(30, 95, 88, 0.14)', border: 'rgba(30, 95, 88, 0.55)', swatch: '#1e5f58' },
  { bg: 'rgba(124, 58, 237, 0.12)', border: 'rgba(124, 58, 237, 0.50)', swatch: '#7c3aed' },
  { bg: 'rgba(217, 119, 6, 0.14)', border: 'rgba(217, 119, 6, 0.55)', swatch: '#d97706' },
  { bg: 'rgba(219, 39, 119, 0.12)', border: 'rgba(219, 39, 119, 0.50)', swatch: '#db2777' },
];

/** Stable hash → palette index: same therapist id always lands on one tint. */
export function therapistTint(id: string): Tint {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return THERAPIST_TINTS[Math.abs(hash) % THERAPIST_TINTS.length]!;
}

export interface CardStyle {
  backgroundColor: string;
  borderColor: string;
  muted: boolean;
  strikethrough: boolean;
}

/**
 * Final card colors. SCHEDULED/CONFIRMED keep the therapist tint; terminal /
 * in-progress statuses carry their own meaning-bearing color (matches
 * calendar.css).
 */
export function statusCardStyle(status: AppointmentStatus, tint: Tint): CardStyle {
  switch (status) {
    case 'IN_PROGRESS':
      return {
        backgroundColor: 'rgba(30, 95, 88, 0.18)',
        borderColor: 'rgba(30, 95, 88, 0.55)',
        muted: false,
        strikethrough: false,
      };
    case 'COMPLETED':
      return {
        backgroundColor: 'rgba(90, 101, 128, 0.14)',
        borderColor: 'rgba(90, 101, 128, 0.30)',
        muted: true,
        strikethrough: false,
      };
    case 'CANCELLED':
      return {
        backgroundColor: 'rgba(216, 222, 232, 0.50)',
        borderColor: 'var(--brand-border)',
        muted: true,
        strikethrough: true,
      };
    case 'NO_SHOW':
      return {
        backgroundColor: 'rgba(220, 38, 38, 0.10)',
        borderColor: 'rgba(220, 38, 38, 0.45)',
        muted: false,
        strikethrough: false,
      };
    default:
      return {
        backgroundColor: tint.bg,
        borderColor: tint.border,
        muted: false,
        strikethrough: false,
      };
  }
}
