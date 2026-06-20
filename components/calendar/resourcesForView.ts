import type { View } from 'react-big-calendar';

/**
 * react-big-calendar only supports resource columns (one lane per therapist)
 * in the single-day time grid. Passing `resources` in week / month / agenda
 * views makes the library render resource sub-columns it can't lay out: the
 * day-name header desyncs from the grid, the first column is clipped at the
 * start edge, and the week overflows its container (Fix Prompt 4 — broken in
 * both locales, independent of the RTL pin-to-LTR handling in calendar.css).
 *
 * Restrict resources to DAY view; every other view renders the standard grid
 * (7 even day columns for week, the month grid, etc.).
 *
 * `import type` keeps this module runtime-free of react-big-calendar so it
 * unit-tests without loading the library.
 */
export function resourcesForView<T>(view: View, resources: T[]): T[] | undefined {
  return view === 'day' && resources.length > 0 ? resources : undefined;
}
