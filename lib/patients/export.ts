import { UserRole, type Gender } from '@prisma/client';
import { patientDisplayName } from '@/lib/format/patientName';

import { db } from '@/lib/db';
import { clinicDateKey } from '@/lib/time/clinic';

import { pendingFirstVisitIds } from './first-visit';
import { displayAgeYears, isUnknownDob } from './schemas';

/**
 * One-click patients roster export (Prompt 55 §4).
 *
 * A ROSTER, not a clinical export: identity + contact + demographics only —
 * no intake answers, no notes, no clinical content. Callers are gated on
 * `patients.export` (Secretary + Admin), which keeps the P15 contact-PII
 * boundary intact at the data layer: Doctor/Therapist can never reach the
 * phone column because they can never reach the endpoint.
 */

export interface PatientsRosterRow {
  fullNameAr: string;
  fullNameEn: string;
  /** Null on imported records with no recorded gender (P50) — renders empty. */
  gender: Gender | null;
  dateOfBirth: Date;
  phone: string | null;
  address: string | null;
  occupation: string | null;
  createdAt: Date;
  pendingFirstVisit: boolean;
}

/** All non-archived patients, ordered by English name with the legacy
 *  Arabic-only records after (P47 row 8 — English is the name; the second
 *  orderBy keeps Arabic-only rows deterministically sorted). */
export async function listPatientsForExport(): Promise<PatientsRosterRow[]> {
  const users = await db.user.findMany({
    where: { role: UserRole.PATIENT, deletedAt: null },
    orderBy: [{ fullNameEn: 'asc' }, { fullNameAr: 'asc' }],
    select: {
      id: true,
      fullNameEn: true,
      fullNameAr: true,
      phone: true,
      createdAt: true,
      patientProfile: {
        select: { dateOfBirth: true, gender: true, address: true, occupation: true },
      },
    },
  });
  // One batch query for the first-visit flag (same discipline as the list page).
  const pending = await pendingFirstVisitIds(users.map((u) => u.id));
  return users
    .filter((u) => u.patientProfile !== null)
    .map((u) => ({
      fullNameAr: u.fullNameAr,
      fullNameEn: u.fullNameEn,
      gender: u.patientProfile!.gender,
      dateOfBirth: u.patientProfile!.dateOfBirth,
      phone: u.phone,
      address: u.patientProfile!.address,
      occupation: u.patientProfile!.occupation,
      createdAt: u.createdAt,
      pendingFirstVisit: pending.has(u.id),
    }));
}

export interface PatientsRosterLabels {
  header: {
    name: string;
    gender: string;
    dob: string;
    age: string;
    phone: string;
    address: string;
    occupation: string;
    createdAt: string;
    firstVisit: string;
  };
  gender: Record<Gender, string>;
  firstVisitPending: string;
  firstVisitDone: string;
}

/** Same escaping rules as the audit CSV (Prompt 15) — quotes, commas, CR, LF. */
function esc(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Pure CSV serialization — the route prepends the UTF-8 BOM so Excel decodes
 * Arabic (audit-export convention). Sentinel DOB (P52: year ≤ 1900 = unknown)
 * renders as EMPTY for both the date and the age — never "1900-01-01", never
 * "126". A phone-less patient renders empty, never "null".
 */
export function buildPatientsRosterCsv(
  rows: PatientsRosterRow[],
  labels: PatientsRosterLabels,
): string {
  const h = labels.header;
  // P47 row 8 — ONE name column: the display name (English; stored Arabic
  // only as the legacy fallback when English is empty).
  const header = [
    h.name,
    h.gender,
    h.dob,
    h.age,
    h.phone,
    h.address,
    h.occupation,
    h.createdAt,
    h.firstVisit,
  ];
  const lines = [header.map(esc).join(',')];
  for (const r of rows) {
    const unknownDob = isUnknownDob(r.dateOfBirth);
    const age = displayAgeYears(r.dateOfBirth);
    lines.push(
      [
        esc(patientDisplayName(r.fullNameEn, r.fullNameAr)),
        // P50: unknown gender renders EMPTY, same convention as sentinel DOB.
        esc(r.gender ? labels.gender[r.gender] : ''),
        unknownDob ? '' : r.dateOfBirth.toISOString().slice(0, 10),
        age === null ? '' : String(age),
        esc(r.phone ?? ''),
        esc(r.address ?? ''),
        esc(r.occupation ?? ''),
        clinicDateKey(r.createdAt),
        esc(r.pendingFirstVisit ? labels.firstVisitPending : labels.firstVisitDone),
      ].join(','),
    );
  }
  return lines.join('\n') + '\n';
}
