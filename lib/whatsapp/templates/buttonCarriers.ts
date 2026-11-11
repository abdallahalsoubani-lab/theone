/**
 * P64 — every outbound template that carries the confirm / decline quick-reply
 * buttons. Inbound reply matching (which booking did the patient answer?) and
 * the secretary's "reminder replies" list key on these names. The v2 reminder
 * is kept for history; the v4 pair is the owner's buttons-everywhere ask.
 */
export const BUTTON_CARRIER_TEMPLATES: string[] = [
  'appointment_reminder_v2',
  'appointment_reminder_v4',
  'appointment_confirmation_v4',
];
