/**
 * P63 — the DAY-view layout switch (owner request 08/10, Google-Calendar
 * style).
 *
 *   - `lanes`  — one resource column per clinician (the default since
 *                Prompt 7; stretching + "other" synthetic lanes, P54).
 *   - `merged` — a single day column where concurrent appointments sit side
 *                by side (rbc `dayLayoutAlgorithm="no-overlap"` already lays
 *                them out as equal-width columns), each chip tinted by its
 *                clinician. Colour ONLY — no clinician name on the chip
 *                (owner decision). A drag in this layout is a time-only move
 *                (no column = no reassign target), exactly like week view.
 *
 * A per-browser display preference remembered in localStorage, like the
 * sidebar collapse (components/shell/Sidebar.tsx) — not a URL param, not a
 * clinic setting. Reads/writes are try/catch-guarded (private windows,
 * blocked storage) and the default is `lanes` so SSR and the first client
 * render always agree; the stored value is applied after mount.
 *
 * Pure module (no React, no rbc runtime) so it unit-tests without the DOM.
 */
export type DayLayout = 'lanes' | 'merged';

export const DAY_LAYOUTS: readonly DayLayout[] = ['lanes', 'merged'];
export const DEFAULT_DAY_LAYOUT: DayLayout = 'lanes';
export const DAY_LAYOUT_STORAGE_KEY = 'theone.calendar.dayLayout';

/** Anything that is not exactly `merged` is the default (`lanes`). */
export function parseDayLayout(raw: unknown): DayLayout {
  return raw === 'merged' ? 'merged' : DEFAULT_DAY_LAYOUT;
}

/** True when the day grid renders per-clinician resource columns. Week /
 *  month / agenda never do (resourcesForView); the merged day doesn't either. */
export function usesResourceLanes(view: string, layout: DayLayout): boolean {
  return view === 'day' && layout === 'lanes';
}

export function readStoredDayLayout(): DayLayout {
  try {
    if (typeof window === 'undefined') return DEFAULT_DAY_LAYOUT;
    return parseDayLayout(window.localStorage.getItem(DAY_LAYOUT_STORAGE_KEY));
  } catch {
    return DEFAULT_DAY_LAYOUT;
  }
}

export function storeDayLayout(layout: DayLayout): void {
  try {
    window.localStorage.setItem(DAY_LAYOUT_STORAGE_KEY, layout);
  } catch {
    // Storage unavailable (private window / blocked) — the choice still
    // applies for this page; it just won't survive a reload.
  }
}
