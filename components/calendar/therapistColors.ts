import { createContext, useContext } from 'react';

/**
 * Per-clinician calendar colours (P64 #7 — «لون مختلف لكل معالج»).
 *
 * The old scheme hashed the therapist id onto 6 tints, so two clinicians
 * could (and with 10 staff, must) share a colour. Now every active clinician
 * gets their OWN tint, assigned automatically by rank: ids sorted ascending.
 * Ids are cuids — time-ordered — so a newly added clinician lands at the end
 * and everyone else keeps their colour. 12 tints cover the clinic's staff
 * without repeats; beyond 12 the palette wraps (still deterministic).
 *
 * Each entry is a soft-fill / strong-border pair readable behind the navy
 * event text. Data-viz coloration (not a brand token) — it sits next to the
 * brand palette without replacing it.
 */
export interface TherapistTint {
  bg: string;
  border: string;
  swatch: string;
}

export const THERAPIST_TINTS: ReadonlyArray<TherapistTint> = [
  { bg: 'rgba(27, 73, 130, 0.12)', border: 'rgba(27, 73, 130, 0.55)', swatch: '#1b4982' }, // brand blue
  { bg: 'rgba(61, 192, 217, 0.16)', border: 'rgba(61, 192, 217, 0.60)', swatch: '#3dc0d9' }, // brand cyan
  { bg: 'rgba(30, 95, 88, 0.14)', border: 'rgba(30, 95, 88, 0.55)', swatch: '#1e5f58' }, // brand teal
  { bg: 'rgba(124, 58, 237, 0.12)', border: 'rgba(124, 58, 237, 0.50)', swatch: '#7c3aed' }, // violet
  { bg: 'rgba(217, 119, 6, 0.14)', border: 'rgba(217, 119, 6, 0.55)', swatch: '#d97706' }, // amber
  { bg: 'rgba(219, 39, 119, 0.12)', border: 'rgba(219, 39, 119, 0.50)', swatch: '#db2777' }, // pink
  { bg: 'rgba(5, 150, 105, 0.13)', border: 'rgba(5, 150, 105, 0.55)', swatch: '#059669' }, // emerald
  { bg: 'rgba(79, 70, 229, 0.12)', border: 'rgba(79, 70, 229, 0.50)', swatch: '#4f46e5' }, // indigo
  { bg: 'rgba(234, 88, 12, 0.12)', border: 'rgba(234, 88, 12, 0.55)', swatch: '#ea580c' }, // orange
  { bg: 'rgba(101, 163, 13, 0.14)', border: 'rgba(101, 163, 13, 0.55)', swatch: '#65a30d' }, // lime
  { bg: 'rgba(192, 38, 211, 0.11)', border: 'rgba(192, 38, 211, 0.50)', swatch: '#c026d3' }, // fuchsia
  { bg: 'rgba(161, 98, 7, 0.13)', border: 'rgba(161, 98, 7, 0.55)', swatch: '#a16207' }, // bronze
];

/** Neutral tint for the synthetic lanes (stretching / other) — never a clinician colour. */
export const NEUTRAL_TINT: TherapistTint = {
  bg: 'rgba(71, 85, 105, 0.10)',
  border: 'rgba(71, 85, 105, 0.45)',
  swatch: '#475569',
};

/** id → tint, one distinct tint per id (rank order, see header). */
export function assignTherapistTints(ids: Iterable<string>): Map<string, TherapistTint> {
  const sorted = [...new Set(ids)].sort();
  return new Map(sorted.map((id, i) => [id, THERAPIST_TINTS[i % THERAPIST_TINTS.length]!]));
}

/** Fallback for an id outside the assignment (e.g. a since-deactivated clinician). */
function hashTint(id: string): TherapistTint {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return THERAPIST_TINTS[Math.abs(hash) % THERAPIST_TINTS.length]!;
}

export function resolveTint(
  tints: Map<string, TherapistTint>,
  id: string,
  isSynthetic: (id: string) => boolean,
): TherapistTint {
  if (isSynthetic(id)) return NEUTRAL_TINT;
  return tints.get(id) ?? hashTint(id);
}

export const TherapistTintContext = createContext<(id: string) => TherapistTint>(hashTint);

export function useTherapistTint(): (id: string) => TherapistTint {
  return useContext(TherapistTintContext);
}
