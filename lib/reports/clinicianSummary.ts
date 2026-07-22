import type { UserRole } from '@prisma/client';

import { db } from '@/lib/db';

/**
 * Clinician sessions summary (Prompt 40) — the clinic manager's «ملخص كل
 * أخصائية بعدد جلساتها» report. Aggregates per assigned clinician over the
 * AppointmentTherapist M2M for a clinic-TZ range.
 *
 * Confirmed counting rules (owner package — do not reinterpret):
 *   - Counted types: SESSION + GROUP only. STRETCHING (no therapist) and
 *     EVENT (no patient) are excluded (§1.4).
 *   - Multi-therapist sessions count ONCE PER assigned clinician (§1.5) —
 *     column totals may exceed the number of distinct sessions; the page
 *     carries the footnote.
 *   - Booked = every non-cancelled appointment in range (scheduled +
 *     confirmed + in-progress + completed + no-show), so Booked ≥ Completed
 *     always reads sensibly (§2.2 definition, shown in the on-screen legend).
 *
 * No patient fields are selected — this surface is clinician-level aggregates
 * only (no PII by construction).
 */

export const COUNTED_TYPES = ['SESSION', 'GROUP'] as const;

export interface ClinicianSummaryRow {
  clinicianId: string;
  fullNameEn: string;
  fullNameAr: string;
  role: UserRole;
  completed: number;
  booked: number;
  cancelled: number;
  noShow: number;
}

export interface ClinicianSummary {
  rows: ClinicianSummaryRow[];
  totals: Pick<ClinicianSummaryRow, 'completed' | 'booked' | 'cancelled' | 'noShow'>;
}

export async function getClinicianSummary(args: {
  start: Date;
  /** Exclusive. */
  end: Date;
}): Promise<ClinicianSummary> {
  const links = await db.appointmentTherapist.findMany({
    where: {
      appointment: {
        startsAt: { gte: args.start, lt: args.end },
        appointmentType: { in: [...COUNTED_TYPES] },
      },
    },
    select: {
      therapistId: true,
      therapist: { select: { fullNameEn: true, fullNameAr: true, role: true } },
      appointment: { select: { status: true } },
    },
  });

  const byId = new Map<string, ClinicianSummaryRow>();
  for (const link of links) {
    let row = byId.get(link.therapistId);
    if (!row) {
      row = {
        clinicianId: link.therapistId,
        fullNameEn: link.therapist.fullNameEn,
        fullNameAr: link.therapist.fullNameAr,
        role: link.therapist.role,
        completed: 0,
        booked: 0,
        cancelled: 0,
        noShow: 0,
      };
      byId.set(link.therapistId, row);
    }
    const status = link.appointment.status;
    if (status === 'CANCELLED') row.cancelled += 1;
    else {
      row.booked += 1; // Booked = all non-cancelled (§2.2)
      if (status === 'COMPLETED') row.completed += 1;
      if (status === 'NO_SHOW') row.noShow += 1;
    }
  }

  // Alphabetical by English name — stable across locales (the page renders
  // the localized name but keeps this consistent order).
  const rows = [...byId.values()].sort((a, b) => a.fullNameEn.localeCompare(b.fullNameEn));
  const totals = rows.reduce(
    (acc, r) => ({
      completed: acc.completed + r.completed,
      booked: acc.booked + r.booked,
      cancelled: acc.cancelled + r.cancelled,
      noShow: acc.noShow + r.noShow,
    }),
    { completed: 0, booked: 0, cancelled: 0, noShow: 0 },
  );
  return { rows, totals };
}
