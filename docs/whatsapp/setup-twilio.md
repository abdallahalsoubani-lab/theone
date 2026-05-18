# Twilio WhatsApp Sandbox — setup guide

This walkthrough takes a fresh clone from zero to "patient receives a real
WhatsApp reminder and reply confirms the appointment". Allow ~10 minutes once
you have a Twilio account.

The Sandbox sends every message from Twilio's shared number **+1 415 523 8886**.
Recipients see a banner labelling the message as sandbox traffic — fine for dev,
not for production. Production graduates to either a Twilio production WhatsApp
number or the Meta Cloud API (see `setup-meta.md`).

## 1. Create or sign in to a Twilio account

1. Go to <https://www.twilio.com/try-twilio> and sign up.
2. Once in the Console, note your **Account SID** and **Auth Token** on the
   dashboard. These map to `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` in
   `.env.local`.

## 2. Join the WhatsApp Sandbox

1. In the Twilio Console go to **Messaging → Try it out → Send a WhatsApp
   message** (also reachable at <https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn>).
2. The page shows a sandbox join code like `join purple-tiger`. From your own
   WhatsApp on your phone, send that exact text to **+1 415 523 8886**.
3. Twilio replies confirming you have joined the sandbox. Every tester needs to
   do this from their personal WhatsApp before they can receive messages from
   the app. Sandbox enrolment expires after 72 hours of inactivity; re-send the
   join code to refresh.

## 3. Expose the local app to the public internet

Twilio webhooks need a public HTTPS URL. In dev we use **ngrok**:

```bash
# Install once:
brew install ngrok           # macOS
# or follow https://ngrok.com/download for other platforms

# Authenticate (one-time):
ngrok config add-authtoken <your-ngrok-authtoken>

# Start a tunnel to the local app:
ngrok http 3000
```

ngrok prints a forwarding URL like `https://abc123.ngrok-free.app`. Copy that
hostname — you'll use it for both `NEXT_PUBLIC_APP_URL` and the Twilio webhook
URL.

## 4. Configure environment variables

In `.env.local`:

```bash
NEXT_PUBLIC_APP_URL="https://abc123.ngrok-free.app"
WHATSAPP_PROVIDER="twilio"
TWILIO_ACCOUNT_SID="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
TWILIO_AUTH_TOKEN="..."
TWILIO_WHATSAPP_FROM="+14155238886"
OTP_SENDER="whatsapp"   # if you want OTPs over WhatsApp too
```

`NEXT_PUBLIC_APP_URL` is read both by the outbound provider (to set the status
callback) and by the webhook route (to verify the X-Twilio-Signature). Keep it
in sync with the ngrok URL — Twilio computes the HMAC against the **exact**
URL you configure on the sandbox page.

## 5. Configure the sandbox webhook

Back in the Twilio Console → **Messaging → Try it out → WhatsApp → Sandbox
settings** (or the gear icon on the Send-a-WhatsApp page):

- **When a message comes in**: `https://abc123.ngrok-free.app/api/v1/whatsapp/webhook/twilio`
- **Method**: POST
- **Status callback URL**: same URL (Twilio uses one endpoint for both)

Save. Sandbox is now wired to deliver both inbound replies and delivery status
updates to the local app.

## 6. Reset the database + start the stack

```bash
pnpm infra:up           # Postgres + Redis + MinIO
pnpm db:reset           # migrations + seed
pnpm dev                # web app
pnpm workers:start      # reminder + outbound workers (separate terminal)
```

The seed populates each WhatsAppTemplate row with a placeholder
`twilioContentSid` of the form `HX_DEV_<name>_<lang>` and `twilioApproved=true`.
**These are not real ContentSids** — Twilio Sandbox does **not** require
pre-approved Content templates because free-form sends inside the sandbox
window work without approval. For sandbox testing the placeholder is enough;
when you graduate to a production Twilio WhatsApp number you'll replace each
placeholder with the real ContentSid from Twilio Content Editor.

## 7. End-to-end smoke test

1. Log in as the seeded Secretary (`+962790000001` / `secret123`).
2. Create a real patient using **your own phone number** (the one you joined
   the sandbox with). The credentials WhatsApp goes through the outbound queue
   — you should receive a message containing the temp password.
3. Book that patient an appointment **35 minutes in the future**.
4. Watch the worker logs: ~5 minutes after booking the reminder fires; you
   receive a real WhatsApp message with the therapist + time.
5. Reply `نعم` (or `yes`) from your WhatsApp.
6. Open Prisma Studio (`pnpm db:studio`) and verify:
   - The `Appointment` row's `status` moved to `CONFIRMED`
   - A new `WhatsAppMessage` row with `direction=INBOUND`, `intent=CONFIRM`,
     and the same `appointmentId` as the outbound reminder
   - An `AuditLog` row with `entityType=Appointment` and
     `after.event=CONFIRMED_VIA_WHATSAPP`

## 8. Failure-mode test

To verify the failure pipeline:

1. Create a patient with a number that has **not** joined the sandbox.
2. Book an appointment 35 minutes out and wait for the reminder.
3. After three retries (~7 minutes) Twilio returns error `63016` (not opted
   in). Check:
   - The patient's `User.whatsappReachable` flag is now `false`
   - An `InboxItem` of type `OUTBOUND_DELIVERY_FAILED` shows up in
     `/secretary/inbox` with a badge in the sidebar
   - The patient profile WhatsApp section turns red with the failure reason

## 9. Troubleshooting

- **403 on webhook**: the `X-Twilio-Signature` did not match. Confirm
  `NEXT_PUBLIC_APP_URL` exactly matches the URL configured in Twilio Console
  including the protocol and trailing path. Also confirm `TWILIO_AUTH_TOKEN`
  is the current one (rotating regenerates the token).
- **No outbound message**: confirm `pnpm workers:start` is running and the
  Redis container is up. The reminder enqueues but does not send — the
  outbound worker is what calls Twilio.
- **"21610 unsubscribed"**: the recipient blocked the sandbox number or hasn't
  joined. They need to re-send the join code from their own WhatsApp.
- **ngrok tunnel resets**: free-tier ngrok URLs change every restart. Update
  both `NEXT_PUBLIC_APP_URL` and the Twilio Console sandbox URL whenever the
  tunnel hostname changes.
