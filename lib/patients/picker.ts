import { patientDisplayName } from '@/lib/format/patientName';
import type { PickerOption } from '@/lib/pickers/filter';

/**
 * THE shared patient-picker option builder (P52 follow-up incident): the
 * booking modal, waitlist form, and inbox link-to-patient all build their
 * options here so search semantics and labels can never diverge from the
 * patients-list again.
 *
 * - Label: bidirectional display name (P50 — an Arabic-only imported
 *   patient must NEVER render a blank label in the English UI), plus the
 *   phone when the viewer is allowed to see it (P15: callers pass null
 *   otherwise — no phone logic here).
 * - Sublabel: the other-script name when it differs — searched too, so an
 *   Arabic query matches rows labeled in English and vice versa
 *   (lib/pickers/filter.ts is the single matching brain, P47).
 */
export interface PatientPickerSource {
  id: string;
  fullNameEn: string;
  fullNameAr: string;
  phone?: string | null;
}

export function patientPickerOption(p: PatientPickerSource, locale: string): PickerOption {
  // P47 row 8 — English-only display (helper falls back to Arabic only for
  // legacy records with no English name); no other-script sublabel anymore.
  const primary = patientDisplayName(p.fullNameEn, p.fullNameAr, locale);
  return {
    id: p.id,
    label: primary + (p.phone ? ` (${p.phone})` : ''),
    sublabel: null,
    // Match-yes/display-no: the stored Arabic name stays searchable.
    searchTerms: p.fullNameAr ? [p.fullNameAr] : [],
  };
}
