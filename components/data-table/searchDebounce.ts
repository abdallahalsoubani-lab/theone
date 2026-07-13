/**
 * Debounced search→URL sync for the shared DataTable (QA Prompt-22 §7.1).
 *
 * Pure (no React, no DOM) so the timing behavior is unit-testable in
 * Vitest's node environment. `schedule` is called on every keystroke: it
 * cancels the pending flush, does nothing when the typed value already
 * matches the durable URL value (post-navigation sync guard — also disarms
 * a stale timer after back/forward navigation), and otherwise arms a single
 * flush `delayMs` later. Net effect: at most one router navigation per
 * typing pause instead of one full RSC round-trip per keystroke.
 */
export const SEARCH_DEBOUNCE_MS = 300;

export interface SearchDebouncer {
  /** (Re)arm the debounce for `query`; disarms when `query === urlValue`. */
  schedule(query: string, urlValue: string): void;
  /** Cancel any pending flush (unmount). */
  cancel(): void;
}

export function createSearchDebounce(
  flush: (value: string) => void,
  delayMs: number = SEARCH_DEBOUNCE_MS,
): SearchDebouncer {
  let handle: ReturnType<typeof setTimeout> | null = null;

  const cancel = (): void => {
    if (handle !== null) {
      clearTimeout(handle);
      handle = null;
    }
  };

  return {
    schedule(query, urlValue) {
      cancel();
      if (query === urlValue) return; // already in sync (incl. post-navigation)
      handle = setTimeout(() => {
        handle = null;
        flush(query);
      }, delayMs);
    },
    cancel,
  };
}
