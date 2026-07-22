import type { UserRole } from '@prisma/client';

/**
 * Which accounts may be impersonated (Prompt 39 addendum — owner ruling on
 * A-20): STAFF only. Admin-on-Admin was always rejected; PATIENT accounts are
 * now excluded too, per the owner's decision to take QA's literal ask (the
 * Prompt-37 verification showed the portal works impersonated, but the owner
 * chose to hide it). One predicate feeds every entry point (users table,
 * patient-file header) AND the server action, so no surface can drift.
 */
export function canActAsTarget(role: UserRole): boolean {
  return role === 'SECRETARY' || role === 'DOCTOR' || role === 'THERAPIST';
}
