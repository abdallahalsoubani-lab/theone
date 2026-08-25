/**
 * P52 — the single named placeholder for a quick-added patient's unknown
 * date of birth. A new patient is created with name + phone only (owner
 * decision 1); their real DOB arrives when they fill the personal intake
 * link, which overwrites this value. This is the ONE definition — never
 * write a bare `new Date('1900-01-01')` anywhere else.
 *
 * Pure + dependency-free so both the server (booking service) and client
 * (patient-file "incomplete data" indicator) share it.
 */
export const PLACEHOLDER_DOB = new Date('1900-01-01T00:00:00.000Z');

/** True while a patient's DOB is still the unknown placeholder (intake not
 *  yet filled). Compared on the UTC instant so timezone never matters. */
export function hasPlaceholderDob(dateOfBirth: Date | string | null | undefined): boolean {
  if (!dateOfBirth) return false;
  const d = dateOfBirth instanceof Date ? dateOfBirth : new Date(dateOfBirth);
  return d.getTime() === PLACEHOLDER_DOB.getTime();
}
