/**
 * Drag-drop therapist decision (Prompt 20 decision #2, pinned by Prompt 34):
 *
 *   - SINGLE-therapist appointment dropped into another therapist's column →
 *     reassign to that lane's therapist (returns the new one-element set);
 *   - MULTI-therapist session → TIME-ONLY move, regardless of which lane it
 *     was dropped in (returns undefined = "keep the existing set"). Changing
 *     WHO is on a shared session goes through "Manage therapists" — a drag
 *     must never silently swap or drop a co-therapist.
 *
 * Pure so the rule is unit-testable outside the calendar component.
 */
export function dragReassignTherapistIds(
  existingTherapistIds: string[],
  dropResourceId: string | undefined,
): string[] | undefined {
  const isMulti = existingTherapistIds.length > 1;
  return !isMulti && dropResourceId && dropResourceId !== existingTherapistIds[0]
    ? [dropResourceId]
    : undefined;
}
