# Meta WhatsApp Cloud API — production setup

The Twilio Sandbox is the right choice for development; production goes through
Meta Cloud API directly. Meta is cheaper per conversation at scale and removes
the sandbox banner — but requires Meta Business verification (1-2 weeks) before
sending to non-test numbers.

This walkthrough covers the steps the project owner does **once** in Meta
Business Manager. The app code is provider-agnostic; flipping
`WHATSAPP_PROVIDER=meta` plus the credential block below is the only change.

## 1. Prerequisites

- A Meta Business account (<https://business.facebook.com/>)
- A Facebook Page (Meta requires one to associate with the WhatsApp Business
  Account)
- A dedicated phone number that is **not active in personal WhatsApp**. If your
  number is currently registered to WhatsApp on a phone, delete that account
  first or use a different number.
- A credit card on file (Meta charges per conversation starting at tier 2;
  tier 1 has 1,000 free conversations/month, which covers small clinics).

## 2. Create the WhatsApp Business App

1. Go to <https://developers.facebook.com/apps>, click **Create App**.
2. Choose **Business** as the use case, name the app
   ("Theone PT — WhatsApp"), and create.
3. From the app dashboard, click **Add product → WhatsApp → Set up**.
4. Meta creates a test phone number you can use immediately for development —
   skip if you're going straight to production.

## 3. Add and verify your production phone number

1. Go to **WhatsApp → API Setup → Step 5: Add a phone number**.
2. Enter your dedicated business phone number with the country code.
3. Verify via SMS or voice call (Meta sends a code).
4. Once verified, the number appears in **WhatsApp → Phone numbers**. Copy the
   **Phone number ID** — this is `META_WHATSAPP_PHONE_ID`.

## 4. Generate an access token

Two options:

### Option A — Temporary token (24-hour, for testing)

On the API Setup page, click **Generate token**. Copy the value — this is
`META_WHATSAPP_TOKEN`. The token expires in 24 hours; fine for verification but
not for production.

### Option B — System User token (permanent, for production)

1. In Business Manager → **Business Settings → Users → System users → Add**.
2. Create a system user with Admin role.
3. Click **Add Assets**, attach your WhatsApp Business App.
4. Click **Generate new token** for that system user, scope to
   `whatsapp_business_messaging` and `whatsapp_business_management`.
5. Copy — this token never expires. Treat as a production secret.

## 5. Configure the webhook

1. In the app dashboard → **WhatsApp → Configuration**.
2. **Callback URL**: `https://<your-domain>/api/v1/whatsapp/webhook/meta`
3. **Verify token**: any string you choose (16+ random characters). Set the
   same value in `.env` as `META_WHATSAPP_VERIFY_TOKEN`.
4. Click **Verify and save**. Meta hits the GET endpoint with `hub.mode=
subscribe` + `hub.verify_token`; the app responds with `hub.challenge`.
5. After verification, subscribe to the **messages** webhook field. This is
   what makes inbound replies + delivery statuses flow to your endpoint.

## 6. Set the app secret

1. In **App settings → Basic**, find **App Secret** and click **Show**.
2. Copy. This is `META_WHATSAPP_APP_SECRET` — Meta signs every webhook body
   with HMAC-SHA256 using this secret and the app verifies the signature.

## 7. Submit templates for approval

Templates are how Meta enforces messaging policy. Every proactive message
(reminder, confirmation, OTP, credentials) goes through a template.

1. **WhatsApp Manager → Account tools → Message templates → Create template**.
2. For each template the app uses (see `prisma/seed/reference-data.ts` for the
   canonical list — 7 templates × 2 languages = 14 rows), create a matching
   Meta template with:
   - **Name**: matches the logical name (e.g., `appointment_reminder_30min`).
     Meta names allow lowercase + underscore only; max 512 chars.
   - **Category**: `UTILITY` for reminders / confirmations / cancellations,
     `AUTHENTICATION` for `otp_login`, `MARKETING` is **not used** in v1.
   - **Language**: English or Arabic — submit each language as its own
     template even though they share a logical name.
   - **Body**: copy the `contentPreview` from the seed file; the `{{1}}` /
     `{{2}}` placeholders match how the app fills parameters.
3. Submit. Approval takes 24-48 hours per template. Each transitions
   `PENDING → APPROVED` (or `REJECTED` with feedback).
4. In `/admin/whatsapp/templates`, find each template row and set:
   - `metaTemplateName` = the name you used in Meta
   - `metaApprovalStatus` = APPROVED (or whatever Meta returned)

The app refuses to send via Meta until both fields are set. There is no
auto-sync in v1; the Admin maintains this manually. A future enhancement
could poll Meta's template-management API.

## 8. Configure environment

```bash
WHATSAPP_PROVIDER="meta"
META_WHATSAPP_PHONE_ID="<from step 3>"
META_WHATSAPP_TOKEN="<from step 4>"
META_WHATSAPP_VERIFY_TOKEN="<from step 5>"
META_WHATSAPP_APP_SECRET="<from step 6>"
```

Restart the web app and the workers. On boot the health check fires a
GET against the phoneId — the log line should read
`[whatsapp] health check: ok (provider=meta)`.

## 9. Important Meta-specific rules

### The 24-hour customer service window

Free-form messages are only allowed within 24 hours of an inbound from the
customer. Templates work any time. The app's proactive messages are
**always** template-based; only the inline acknowledgements the inbound
parser fires after a patient reply are free-form, and those are by
construction inside the window (the patient just messaged us).

### Rate limits + pricing tiers

New WhatsApp Business Accounts start at **tier 1** (1,000 free conversations
/ 24h). A "conversation" is a 24h window initiated by either side. Tiers
auto-upgrade as your account quality score stays green:

- Tier 1: 1k conversations/day (free)
- Tier 2: 10k/day
- Tier 3: 100k/day
- Tier 4: unlimited

A clinic of 50 patients/day stays well within tier 1 forever. Marketing
templates are billed per conversation; utility / authentication are
significantly cheaper.

### Pricing per region

Jordan is in Meta's Middle East & Africa pricing bracket. Conversations are
priced in USD at the rates published in <https://business.whatsapp.com/products/platform-pricing>.

### Account quality

Meta scores accounts on user complaints + block rates. If the score drops to
**LOW** for an extended period, Meta may downgrade tiers; if to **FLAGGED**,
the account is suspended. Defenses:

- Send templates only to patients who expect them (always do this for our
  workflow)
- Honour opt-outs immediately (the app already does this via the
  `RECIPIENT_OPTED_OUT` mapping)
- Don't bulk-send unsolicited content (we don't — no marketing flow exists
  in v1)

## 10. Verifying the switch from Twilio to Meta

The fastest way to confirm Meta is wired correctly:

1. Set `WHATSAPP_PROVIDER=meta` and restart.
2. Boot log: `[whatsapp] active provider: meta` followed by
   `[whatsapp] health check: ok`.
3. Send a test message from `/admin/whatsapp/templates`.
4. In `/admin/whatsapp/messages` the resulting row's `providerMessageId`
   starts with `wamid.` — that confirms Meta accepted the send. (Twilio
   IDs are `SM…` or `MM…`.)

If health check fails, check:

- Token has not expired (24h temporary tokens are the most common cause)
- Phone number ID is correct (it's the numeric id, not the actual phone)
- The phone has not been re-registered in personal WhatsApp (Meta
  invalidates the WABA registration)
