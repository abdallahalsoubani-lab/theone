/**
 * Arrival notification seam (July change request #2 — DEFERRED).
 *
 * Called once per arrival at the moment a check-in is committed:
 *   - a back-to-back run (grouped) → ONE call for the whole run → one message;
 *   - spaced-apart appointments → a separate arrival (and call) each.
 *
 * This is intentionally a NO-OP for now. The WhatsApp arrival-confirmation
 * message is deferred until Meta credentials are configured. When item 2 is
 * picked up, the send (including adult-vs-child recipient routing) plugs in
 * HERE — no other code needs to change: `appointmentIds` is exactly the set of
 * appointments this one message should cover.
 */
export async function notifyArrival(_patientId: string, _appointmentIds: string[]): Promise<void> {
  // TODO(July item 2): enqueue the WhatsApp arrival-confirmation message for
  // `_patientId` covering `_appointmentIds`. No-op until Meta creds land.
}
