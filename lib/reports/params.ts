import { clinicDateKey } from '@/lib/time/clinic';

import { customRange, presetRange, type ReportRange, type ReportScope } from './range';

/**
 * One resolver shared by the report page and the CSV export so both always
 * agree on the range (Prompt 40). Query params:
 *   ?scope=today|week|month           — preset cards
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD    — free range (to inclusive)
 * Invalid/missing input falls back to `today`.
 */

export interface ResolvedReportRange extends ReportRange {
  scope: ReportScope | 'custom';
  /** Clinic-local calendar keys for display + the export filename. */
  fromKey: string;
  toKey: string;
}

export function resolveReportRange(
  params: { scope?: string; from?: string; to?: string },
  now: Date = new Date(),
  timeZone?: string,
): ResolvedReportRange {
  let range: ReportRange | null = null;
  let scope: ResolvedReportRange['scope'] = 'today';

  if (params.from && params.to) {
    range = customRange(params.from, params.to, timeZone);
    if (range) scope = 'custom';
  }
  if (!range) {
    const preset: ReportScope =
      params.scope === 'week' || params.scope === 'month' ? params.scope : 'today';
    scope = preset;
    range = presetRange(preset, now, timeZone);
  }

  return {
    ...range,
    scope,
    fromKey: clinicDateKey(range.start, timeZone),
    // `end` is exclusive — the displayed/exported "to" is the last included day.
    toKey: clinicDateKey(new Date(range.end.getTime() - 1), timeZone),
  };
}
