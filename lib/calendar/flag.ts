/**
 * Custom-calendar feature flag resolution (Custom Calendar Phase 1).
 *
 * Precedence: an explicit per-request `?calendar=custom|rbc` query param wins
 * (for QA), otherwise the `NEXT_PUBLIC_CUSTOM_CALENDAR` env default applies.
 * Pure + tested so the rollout logic is verifiable without a browser.
 */
export type CalendarParam = string | string[] | undefined;

export function resolveCustomCalendar(param: CalendarParam, envEnabled: boolean): boolean {
  const value = Array.isArray(param) ? param[0] : param;
  if (value === 'custom') return true;
  if (value === 'rbc') return false;
  return envEnabled;
}
