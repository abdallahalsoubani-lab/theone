# WhatsApp templates — how they're managed

## Architectural shape

The app references templates by a **logical name** (column `name` in
`WhatsAppTemplate`). Every call site looks up the template by `(name,
language)` — never by Meta's name or Twilio's ContentSid. Provider-specific
identifiers (Meta template name + approval status, Twilio ContentSid +
approved flag) live in their own columns and are read only by the active
provider implementation in `lib/whatsapp/providers/{meta,twilio}.ts`.

This separation is what lets `WHATSAPP_PROVIDER` swap providers without
touching any call site code.

## Canonical template list

Defined in `prisma/seed/reference-data.ts`. Each row exists once per language
(EN + AR):

| Logical name                  | Category     | Body (EN preview)                                                                                 |
| ----------------------------- | ------------ | ------------------------------------------------------------------------------------------------- |
| `appointment_confirmation`    | APPOINTMENT  | Hi {{1}}, your appointment with {{2}} is confirmed for {{3}} at {{4}}.                            |
| `appointment_reminder_30min`  | APPOINTMENT  | Reminder: your appointment with {{1}} is in 30 minutes at {{2}}.                                  |
| `appointment_rescheduled`     | APPOINTMENT  | Your appointment has been moved to {{1}} at {{2}} with {{3}}.                                     |
| `appointment_cancelled`       | APPOINTMENT  | Your appointment on {{1}} at {{2}} has been cancelled. Reason: {{3}}.                             |
| `home_exercise_reminder`      | HOME_PROGRAM | Time for exercise "{{1}}". Therapist note: {{2}}. Watch: {{3}}.                                   |
| `otp_login`                   | OTP          | Your Theone.pt login code is {{1}}. It expires in 5 minutes.                                      |
| `patient_account_credentials` | CREDENTIALS  | Welcome to Theone.pt. Login: {{1}}, temporary password: {{2}}. Please change it on first sign-in. |

Parameter order is locked in code (`lib/whatsapp/templates/sendCredentials.ts`,
`workers/reminder.ts`, etc.). Changing the body of a template in Meta
**requires** a coordinated update on the code side; reordering `{{1}}` and
`{{2}}` silently produces a wrong-looking message.

## Shared family numbers — inbound routing + patient-name audit (Prompt 57)

One phone may belong to several active patients. Inbound messages (and the
P56 attachments hanging off them) are attributed by ONE rule,
`lib/whatsapp/inbound/resolve-patient.ts → resolvePatientForInbound`:
nearest active appointment (SCHEDULED/CONFIRMED/IN_PROGRESS, end not
passed; tie → reminded first, then older record), else the most recently
active patient (latest non-cancelled appointment, then `updatedAt`, then
id). `resolveReplyTargets` delegates to it, so `WhatsAppMessage.recipientId`,
`InboxItem.patientId`, `WhatsAppConversation.patientId` and the attachment
rows always agree. There is no manual "move this message to the sibling"
tool yet — natural follow-up if the clinic ever reports a mis-route.

Outbound is per patient (jobs read the phone from the patient's own row), so
a mother with two children booked the same day receives two messages.
Which business-initiated templates name the patient today:

| Template                                      | Names the patient?                 |
| --------------------------------------------- | ---------------------------------- |
| `appointment_confirmation_v2`                 | ✓ `{{1}}`                          |
| `new_patient_confirmation`                    | ✓ `{{1}}`                          |
| `appointment_rescheduled` (v2 shape)          | ✓ `{{1}}`                          |
| `appointment_reminder_v2` (fallback only)     | ✓ `{{1}}`                          |
| `arrival_confirmation`                        | ✓ first name                       |
| confirm ack (free text)                       | ✓                                  |
| `appointment_reminder_single_v3` / `_multi`   | ✗ — two children = two look-alikes |
| `appointment_cancelled_v2` (date/time/reason) | ✗                                  |
| `home_exercise_reminder_v2`                   | ✗                                  |
| decline ack (free text)                       | ✗                                  |

Adding the name to the v3 reminders / cancelled / home-exercise wording is a
Twilio Console template edit + re-approval (owner task); the code passes
variables as-is.

## Workflow per provider

### Twilio Sandbox

Sandbox does not require pre-approved Content templates — free-form text
inside the sandbox is acceptable. The dev seed populates each row with a
placeholder `twilioContentSid` of the form `HX_DEV_<name>_<lang>` and
`twilioApproved=true`, which the Twilio provider treats as configured. Real
ContentSids come into play when you switch from Sandbox to a Twilio
production WhatsApp number — at that point an Admin pastes the actual
ContentSid into each row via `/admin/whatsapp/templates`.

### Meta production

Every template is created **manually** in Meta Business Manager
(WhatsApp Manager → Message templates → Create template). Approval takes
24-48h per template. The Admin then sets `metaTemplateName` and flips
`metaApprovalStatus` to `APPROVED` per template in
`/admin/whatsapp/templates`. The Meta provider refuses to send a template
that is not approved (`TEMPLATE_NOT_APPROVED` error, non-retryable).

## Future enhancement: auto-sync Meta approval status

Meta exposes a `/{whatsapp_business_account_id}/message_templates` endpoint
that returns approval status per template. A scheduled job could:

1. Poll the endpoint every 6 hours
2. Diff against the local `WhatsAppTemplate.metaApprovalStatus` values
3. Auto-promote PENDING → APPROVED rows

Not implemented in v1 — the Admin maintains status manually because the
volume is tiny (14 rows) and the polling adds operational complexity that
isn't worth it at this scale.

## Adding a new template

1. Add the row to `prisma/seed/reference-data.ts` (both EN and AR).
2. Run `pnpm db:seed` to upsert.
3. Add a corresponding template in Meta Business Manager (production) /
   Twilio Content Editor (production Twilio number).
4. Submit for approval.
5. Once approved, set the provider identifiers via
   `/admin/whatsapp/templates`.
6. Add a sender helper in `lib/whatsapp/templates/` that calls
   `enqueueWhatsappOutbound` with the correct parameter array — keep the
   parameter order locked next to the body string for easy review.
