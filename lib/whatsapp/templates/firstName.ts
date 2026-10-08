/**
 * The patient's FIRST name in their preferred language — the `{{1}}` of the
 * arrival template (July 31 item 3) and of the P60 custom-message frame.
 * One helper so both templates greet the patient identically.
 */
export function patientFirstName(patient: {
  fullNameEn: string | null | undefined;
  fullNameAr: string | null | undefined;
  languagePref: 'AR' | 'EN';
}): string {
  const isAr = patient.languagePref === 'AR';
  const en = patient.fullNameEn?.trim() ?? '';
  const ar = patient.fullNameAr?.trim() ?? '';
  const fullName = (isAr ? ar : en) || en || ar;
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

/**
 * P62 — the same rule for a STAFF recipient (the clinician greeted by the
 * internal arrival alert). Same body on purpose: one first-name rule for
 * every `{{1}}` greeting, whoever the recipient is.
 */
export const userFirstName = patientFirstName;
