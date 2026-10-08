import { isSilentModeOn, holdForOutbox } from '@/lib/whatsapp/silent-mode';
import { sendArrivalConfirmation } from '@/lib/whatsapp/templates/sendArrival';
import { sendStaffArrivalAlerts } from '@/lib/whatsapp/templates/sendStaffArrivalAlert';

/**
 * Arrival notification seam (July change request #2 — filled by the July 31
 * bundle, item 3; P62 added the staff half).
 *
 * Called once per arrival at the moment a check-in is committed:
 *   - a back-to-back run (grouped) → ONE call for the whole run → one message;
 *   - spaced-apart appointments → a separate arrival (and call) each;
 *   - the secretary's manual check-in goes through the same seam
 *     (`manualCheckIn` in ./kiosk.ts), one commit = one call.
 *
 * Two independent halves, each isolated:
 *   1. The PATIENT's arrival confirmation — policy-gated (P51 silent mode
 *      holds it in the outbox).
 *   2. P62 — the INTERNAL "your patient has arrived" alert to the assigned
 *      clinicians. Staff-bound, so it is NOT gated by the silent mode, the
 *      P48 modes, or the outbox (owner decision 08/10): it goes straight to
 *      the outbound queue whenever the clinician has a phone on file.
 *
 * Every WhatsApp send is ENQUEUED, never inline — and any failure in either
 * half (Redis down, patient row gone, template misconfigured) is swallowed
 * after logging, because a messaging problem must never fail or delay the
 * check-in itself, and a failure in one half must never silence the other.
 * Adult-vs-child recipient routing is a separate deferred WhatsApp item.
 */
export async function notifyArrival(patientId: string, appointmentIds: string[]): Promise<void> {
  await notifyPatient(patientId, appointmentIds);
  await notifyAssignedStaff(patientId, appointmentIds);
}

async function notifyPatient(patientId: string, appointmentIds: string[]): Promise<void> {
  try {
    // P51 — silent mode: hold the arrival confirmation in the outbox
    // (anchored to the run's first appointment) instead of sending.
    if (await isSilentModeOn()) {
      await holdForOutbox({
        type: 'ARRIVAL',
        appointmentId: appointmentIds[0] ?? null,
        patientId,
      });
      return;
    }
    await sendArrivalConfirmation({ patientId, appointmentIds });
  } catch (err) {
    // Redacted: ids only, never a phone/name.
    console.error(
      `[arrival] failed to enqueue arrival message for patient=${patientId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

async function notifyAssignedStaff(patientId: string, appointmentIds: string[]): Promise<void> {
  try {
    await sendStaffArrivalAlerts({ patientId, appointmentIds });
  } catch (err) {
    // Redacted: ids only, never a phone/name.
    console.error(
      `[arrival] failed to enqueue staff arrival alert for patient=${patientId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
