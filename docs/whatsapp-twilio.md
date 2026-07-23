# WhatsApp via Twilio — owner runbook (Prompt 45)

Today's facts (2026-07-23, do not re-derive):

| Item                     | Value                                                                 |
| ------------------------ | --------------------------------------------------------------------- |
| Sender number            | `+962780150215` (re-registered via Twilio Self Sign-up)               |
| New WABA ID              | `1645151657192049` (the old WABA / phone-number-id are obsolete)      |
| Meta Business Manager ID | `1014675812673266`                                                    |
| Twilio account           | "the one pt", Account SID starts `ACf7d9…`                            |
| Sender status            | Offline at registration (normal) — wait for **Online** before go-live |

The code ships with `WHATSAPP_PROVIDER=meta` still set: **zero behavior change**
until you flip the switch in §4. Meta's health check keeps failing (dead WABA
token) — expected; ignore it until the flip.

---

## 1. Env vars — what to copy from where

Edit `~/theone/.env` AND `~/theone/.env.local` on the VM (never paste secrets
into any chat):

| Env var                | Where in the Twilio Console                                        |
| ---------------------- | ------------------------------------------------------------------ |
| `TWILIO_ACCOUNT_SID`   | Console home → Account Info → **Account SID** (`AC…`)              |
| `TWILIO_AUTH_TOKEN`    | Console home → Account Info → **Auth Token** (click reveal)        |
| `TWILIO_WHATSAPP_FROM` | `+962780150215` (bare international format, no `whatsapp:` prefix) |

The WhatsApp **Sender SID (XE…)** (Messaging → Senders → WhatsApp senders →
Edit Sender) is NOT an env var — you only need it to find the sender's
configuration page in §2.

## 2. Webhook URL — paste into the sender configuration

Messaging → Senders → WhatsApp senders → `+962780150215` → **Edit Sender** →
Endpoint configuration:

```
Webhook URL for incoming messages:  https://theonephysio.com/api/v1/whatsapp/webhook/twilio
Status callback URL:                https://theonephysio.com/api/v1/whatsapp/webhook/twilio
```

(One endpoint handles both — inbound messages and delivery-status callbacks.
It verifies `X-Twilio-Signature` and answers 403 to anything unsigned, and
403s all posts while a different provider is active.)

## 3. Content SIDs — after template approval

Templates were submitted from `docs/whatsapp-twilio-templates.md` — **10
entries** (owner decision 2026-07-23: `otp_login` and
`patient_account_credentials` deferred; their rows are `active=false` so the
health check ignores them until you activate them). When each is **Approved**,
open it in Content Template Builder and copy its **Content SID (`HX…`)**.

Paste each SID into the app: **Admin → WhatsApp → Templates** — each row
(name × language) has a Twilio Content SID field. **10 SIDs** total (ar and en
are separate SIDs of the same logical template).

The health check refuses to go green while any ACTIVE template row is missing
its SID, and it names the missing ones in the log — that's your checklist.

## 4. Go-live switch (after: sender **Online** + templates approved + SIDs pasted)

```bash
# on the VM, in ~/theone
# 1. edit .env + .env.local:  WHATSAPP_PROVIDER=twilio  (+ the three TWILIO_* vars from §1)
# 2. restart both processes with the new env:
export PATH=$HOME/.nvm/versions/node/v20.20.2/bin:$PATH
pm2 restart theone theone-workers --update-env
# 3. watch the health check:
pm2 logs theone --lines 20 --nostream | grep whatsapp
#    expect:  [whatsapp] active provider: twilio
#             [whatsapp] health check: ok (provider=twilio)
#    a "MISSING Content SIDs" line names exactly what's left to paste.
```

**One real test message:** book a test appointment for a patient row that has
YOUR phone number → the confirmation template should arrive on your WhatsApp
within seconds. Then check Admin → WhatsApp → Messages shows it SENT/DELIVERED.

## 5. Rollback

Set `WHATSAPP_PROVIDER=meta` (or `console` to stop sending entirely) in both
env files and `pm2 restart theone theone-workers --update-env`. Nothing else
to undo — templates/SIDs stay in the DB unused until the next flip.

## 6. Still in the ledger (deliberately NOT in this runbook)

24h-vs-12h reminder timing (ask the clinic at flip time) · arrival message
(`notifyArrival` stub) · OTP re-enable (needs `otp_login` approved + template
row activated) · waitlist outreach.
