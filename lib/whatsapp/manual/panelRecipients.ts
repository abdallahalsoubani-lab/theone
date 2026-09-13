/**
 * P61 follow-up — the CLIENT-side twin of `getMessageRecipients`.
 *
 * The side panel decides two things before it talks to the server: does this
 * appointment have anyone to message, and can any of them actually receive
 * something. Both must follow the SAME rule as the server helper — scalar
 * patient if there is one, else the GROUP members — and, critically, both must
 * read the phone from the SAME place they read the recipient from.
 *
 * The bug this closes: the panel counted recipients from the group members but
 * read `hasPhone` from the scalar `patientPhone`, which is null for a GROUP.
 * A group of exactly ONE member therefore hit `recipientCount === 1 &&
 * !hasPhone` and rendered "No phone number on file for this patient" over a
 * patient whose number was sitting on the membership row. Groups of 2+ were
 * unaffected, which is why the bug survived the P61 tests.
 *
 * Keeping the id and the phone in one shape makes that mismatch unrepresentable.
 */

export interface PanelRecipient {
  id: string;
  phone: string | null;
}

export interface PanelRecipientSource {
  /** The scalar patient (empty string / null for a GROUP or an EVENT). */
  patientId: string | null;
  /** The scalar patient's P15-gated phone — meaningless without `patientId`. */
  patientPhone: string | null;
  /** GROUP members, each carrying their own P15-gated phone. */
  groupPatients?: { id: string; phone: string | null }[] | null;
}

export function panelRecipients(appt: PanelRecipientSource): PanelRecipient[] {
  if (appt.patientId) {
    return [{ id: appt.patientId, phone: appt.patientPhone || null }];
  }
  return (appt.groupPatients ?? []).map((m) => ({ id: m.id, phone: m.phone || null }));
}

/** True when at least one recipient can actually be sent to. */
export function anyRecipientReachable(recipients: PanelRecipient[]): boolean {
  return recipients.some((r) => Boolean(r.phone));
}
