import { isSilentModeOn, holdForOutbox } from '@/lib/whatsapp/silent-mode';
import { sendArrivalConfirmation } from '@/lib/whatsapp/templates/sendArrival';

/**
 * Arrival notification seam (July change request #2 — filled by the July 31
 * bundle, item 3).
 *
 * Called once per arrival at the moment a check-in is committed:
 *   - a back-to-back run (grouped) → ONE call for the whole run → one message;
 *   - spaced-apart appointments → a separate arrival (and call) each;
 *   - the secretary's manual check-in goes through the same seam
 *     (`manualCheckIn` in ./kiosk.ts), one commit = one call.
 *
 * The WhatsApp send is ENQUEUED, never inline — and any failure here (Redis
 * down, patient row gone, template misconfigured) is swallowed after logging,
 * because a messaging problem must never fail or delay the check-in itself.
 * Adult-vs-child recipient routing is a separate deferred WhatsApp item.
 */
export async function notifyArrival(patientId: string, appointmentIds: string[]): Promise<void> {
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
