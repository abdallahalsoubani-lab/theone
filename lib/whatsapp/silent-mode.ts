import type { WaDispatchType } from '@prisma/client';

import { db } from '@/lib/db';

/**
 * P51 — the ONE silent-mode gate (master hold-all switch, owner option B).
 *
 * When `ClinicSettings.whatsappSilentMode` is ON, no patient-bound WhatsApp
 * message is ever sent automatically: every automatic send path consults
 * `isSilentModeOn()` at its fire/send moment and, instead of sending,
 * parks a WhatsAppDispatch row via `holdForOutbox()` (or, for reply-button
 * acks, suppresses entirely — an ack days later is meaningless).
 *
 * Exempt by owner decision: patient login OTP + account credentials
 * (patient-initiated, functional) and every HUMAN-initiated send (staff
 * inbox reply, admin resend, the outbox Send button — those jobs carry
 * `adminSend: true` and bypass the gate).
 *
 * db-only (no Next request machinery) so BullMQ workers can import it —
 * same rule as dispatch/outcome.ts. The setting is read LIVE on every
 * check; nothing caches it across a toggle.
 *
 * ⚠️ Decision reversal (owner-approved, P51 §1.4): under silent mode the
 * P17 24h reminder and the home-program reminder ARE gated — reversing
 * "التذكير يبقى تلقائياً" (P50 decision 3) and the P48 rule that dispatch
 * control never touches the reminder path.
 */
export async function isSilentModeOn(): Promise<boolean> {
  const s = await db.clinicSettings.findUnique({
    where: { id: 'default' },
    select: { whatsappSilentMode: true },
  });
  return s?.whatsappSilentMode ?? false;
}

/**
 * Park one held message in the outbox (status PENDING). Reference-only —
 * content is re-derived at send time by the same sender the automatic path
 * uses (C-3 lesson: payload-carrying queues were a live PII/staleness bug).
 * Idempotent per (type, appointment/homeProgramItem): an already-PENDING
 * hold is reused, so a re-fired job never doubles the outbox row.
 * Returns the row id.
 */
export async function holdForOutbox(args: {
  type: WaDispatchType;
  appointmentId?: string | null;
  patientId?: string | null;
  homeProgramItemId?: string | null;
}): Promise<string> {
  const existing = await db.whatsAppDispatch.findFirst({
    where: {
      type: args.type,
      status: 'PENDING',
      ...(args.appointmentId ? { appointmentId: args.appointmentId } : {}),
      ...(args.homeProgramItemId ? { homeProgramItemId: args.homeProgramItemId } : {}),
    },
    select: { id: true },
  });
  if (existing) return existing.id;
  const row = await db.whatsAppDispatch.create({
    data: {
      type: args.type,
      status: 'PENDING',
      appointmentId: args.appointmentId ?? null,
      patientId: args.patientId ?? null,
      homeProgramItemId: args.homeProgramItemId ?? null,
    },
    select: { id: true },
  });
  console.warn(
    `[silent-mode] held ${args.type} for ${args.appointmentId ?? args.homeProgramItemId ?? args.patientId ?? '<unknown>'}`,
  );
  return row.id;
}

/**
 * Re-park a SCHEDULED lifecycle entry back to PENDING — used when an AUTO
 * job scheduled while silent mode was OFF fires while it is ON: the send
 * is skipped and the entry returns to the outbox instead.
 */
export async function reparkScheduled(args: {
  appointmentId: string;
  type: WaDispatchType;
}): Promise<void> {
  await db.whatsAppDispatch.updateMany({
    where: { appointmentId: args.appointmentId, type: args.type, status: 'SCHEDULED' },
    data: { status: 'PENDING', dispatchReason: null },
  });
  console.warn(`[silent-mode] held ${args.type} for ${args.appointmentId} (re-parked from AUTO)`);
}
