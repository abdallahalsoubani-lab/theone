/**
 * How an exercise's name reads wherever it is listed, picked or printed
 * (PT-B5 item 2).
 *
 * The clinic's complaint: once an exercise has been edited, its versions are
 * indistinguishable in a dropdown — two identical lines, and no way to tell
 * which one a patient's program actually references.
 *
 * The rule: show the version ONLY where a version chain exists, so a library
 * of never-edited exercises stays clean. That means BOTH ends of a chain are
 * marked — the superseded v1 as well as the current v2 — because "v2" next to
 * a bare name would still leave the reader guessing what the bare one is.
 *
 * Pure, and takes the already-translated suffix, so it unit-tests without
 * React or next-intl and the wording stays in the message catalogues.
 */

export interface ExerciseVersionMeta {
  version: number;
  /** True when a newer version replaced this row (`replacedById` is set). */
  superseded?: boolean;
}

/**
 * True when this exercise belongs to a chain, i.e. it has been edited at least
 * once — either it IS a later version, or it has been replaced by one.
 */
export function hasVersionHistory(meta: ExerciseVersionMeta): boolean {
  return meta.version > 1 || meta.superseded === true;
}

/**
 * `name` for a never-edited exercise, `name + suffix` for one with history.
 * `suffix` receives the version number and returns the localized marker
 * (e.g. `v2` / `نسخة 2`), already wrapped however the catalogue wants it.
 */
export function exerciseDisplayName(
  name: string,
  meta: ExerciseVersionMeta,
  suffix: (version: number) => string,
): string {
  return hasVersionHistory(meta) ? `${name} ${suffix(meta.version)}` : name;
}
