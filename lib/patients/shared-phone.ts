import { UserRole } from '@prisma/client';

import { db } from '@/lib/db';
import { patientDisplayName } from '@/lib/format/patientName';

/**
 * P57 — shared family numbers. One phone may be registered on any number of
 * active patients (P50 dropped the patient-phone unique index; a mother
 * books two children on her own number). This module is the ONE lookup
 * behind every "who else holds this number" surface: the create-form
 * confirm dialog (P50 §5.3), the quick-add confirm in the booking modal, the
 * live hint under the phone field, the patient-header badge and the list
 * badge. Informational everywhere — never a block.
 *
 * Phone privacy (Prompt 15): callers on Doctor/Therapist surfaces must not
 * call this at all — the phone itself is hidden from them, so the badge is
 * too. The data layer (`getPatientFile` / `listPatients`) nulls it by scope.
 */
export interface SharedPhoneHolder {
  id: string;
  fullNameEn: string;
  fullNameAr: string;
}

/** Every ACTIVE patient on `phone`, optionally excluding one record (the
 *  patient being edited / displayed), oldest first. */
export async function findSharedPhoneHolders(
  phone: string,
  excludeId?: string | null,
): Promise<SharedPhoneHolder[]> {
  if (!phone) return [];
  const rows = await db.user.findMany({
    where: {
      phone,
      deletedAt: null,
      role: UserRole.PATIENT,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, fullNameEn: true, fullNameAr: true },
    orderBy: { createdAt: 'asc' },
  });
  return excludeId ? rows.filter((r) => r.id !== excludeId) : rows;
}

/** "Ahmad، Sara" — display names joined for the confirm message / badge. */
export function sharedPhoneHolderNames(holders: SharedPhoneHolder[], locale?: string): string {
  return holders
    .map((h) => patientDisplayName(h.fullNameEn, h.fullNameAr, locale))
    .join(locale === 'ar' ? '، ' : ', ');
}
