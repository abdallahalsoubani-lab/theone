import type { WaDispatchType } from '@prisma/client';

import { db } from '@/lib/db';
import type { LifecycleKind } from '@/lib/queue/jobs/appointmentReminder';

/**
 * P48 — worker-side outcome reporting, split from service.ts so the BullMQ
 * worker never drags the Next-request-scoped audit/session machinery into
 * its runtime. db-only.
 */
const TYPE_BY_KIND: Record<LifecycleKind | 'reminder' | 'arrival', WaDispatchType> = {
  confirmation: 'BOOKING_CONFIRMATION',
  reschedule: 'RESCHEDULE',
  cancellation: 'CANCELLATION',
  // P51 — outbox-sent holds report their outcome the same way.
  reminder: 'REMINDER',
  arrival: 'ARRIVAL',
};

/**
 * Flip the latest SCHEDULED entry for (appointment, kind) to SENT/FAILED
 * once the send actually ran. Pre-P48 queued jobs may have no entry —
 * nothing to flip.
 */
export async function markDispatchOutcome(args: {
  appointmentId: string;
  kind: LifecycleKind | 'reminder' | 'arrival';
  ok: boolean;
  error?: string;
}): Promise<void> {
  const entry = await db.whatsAppDispatch.findFirst({
    where: {
      appointmentId: args.appointmentId,
      type: TYPE_BY_KIND[args.kind],
      status: 'SCHEDULED',
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (!entry) return;
  await db.whatsAppDispatch.update({
    where: { id: entry.id },
    data: args.ok
      ? { status: 'SENT', sentAt: new Date() }
      : { status: 'FAILED', failureReason: args.error?.slice(0, 500) ?? 'send failed' },
  });
}
