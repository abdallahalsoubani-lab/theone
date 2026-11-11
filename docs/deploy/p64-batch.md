# P64 batch — owner's 17 items (one deploy)

> **Status: ✅ DEPLOYED 2026-11-11 ~13:35 UTC** — `2ace481` on the prod VM,
> all 5 migrations applied, `pnpm db:generate` run, pm2 `theone` +
> `theone-workers` restarted, `/ar` `/en` `/…/login` = 200, protected new
> routes (`schedule-access`, `therapist/plans/new`) = 307 → login.
> DB backup taken first: `~/backup-pre-p64-2026-11-11.sql` (9.1 MB, VM home).
> v4 button templates created + submitted the same day (see below).

Everything ships together (owner decision: «كلهم بدفعة واحدة»).

## Migrations (5, all additive — validated: migrations ≡ schema, empty diff)

| Migration                                          | What                                                                                                       |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `20261111090000_p64_intake_fixed_fields_optional`  | #8 — fixed intake columns `DROP NOT NULL` (old answers kept)                                               |
| `20261111090100_p64_intake_link_notification`      | #9 + #10 — `NotificationType` += `INTAKE_LINK_COMPLETED`, `PLAN_INITIAL_PROPOSED`                          |
| `20261111090200_p64_schedule_view_grants`          | #4 — `ScheduleViewGrant` (viewer therapist → owner clinician)                                              |
| `20261111090300_p64_session_result_monthly_report` | #11 — `SessionNote.result/treatmentGiven` + `MonthlyReport`                                                |
| `20261111090400_p64_home_program_pdf`              | #15 — `Exercise.goalEn/goalAr/extraImageUrls`, `HomeProgramItem.goal/photoDocumentIds`, `HomeProgramCover` |

## Deploy steps (VM — see the prod-VM runbook for SSH / PATH)

1. `git pull` → `pnpm install --frozen-lockfile`
2. `pnpm prisma migrate deploy` **then `pnpm db:generate`** (migrate deploy does
   not regenerate the client — P52-56 lesson).
3. `pnpm build` → `pm2 restart all` (web + workers).
4. Smoke: `/ar/secretary/calendar?date=<last week>` shows last week's bookings;
   `/ar/admin/schedule-access` loads; a home-program PDF downloads.

## WhatsApp button templates (#2 / #3) — needs owner approval, outward-facing

The reminder already names the real day («يوم السبت 14 نوفمبر») through the
approved `clinic_custom_message` frame — no template action needed for the
«غداً» fix. The confirm/decline buttons need four NEW Twilio templates:

```bash
pnpm tsx scripts/create-button-templates.ts --dry-run   # prints the 4 bodies/buttons
pnpm tsx scripts/create-button-templates.ts --apply     # creates + submits (UTILITY) + registers
```

`--apply` creates the Twilio Content rows and submits them to WhatsApp. Run it
only with the owner's go-ahead. Nothing switches at that moment: the hourly
approval sync flips `twilioApproved`, and the send paths prefer the v4 buttons
from then on (reminder: v4 → custom frame → legacy; confirmation: v4 → v2).

### Applied 2026-11-11 (owner approved)

| Template / language              | Content SID                          |
| -------------------------------- | ------------------------------------ |
| `appointment_reminder_v4` AR     | `HXab4e63fc53dccef37ac6553c4cd83a5c` |
| `appointment_reminder_v4` EN     | `HX0ce889c673655b6eb81b6651039e1f4b` |
| `appointment_confirmation_v4` AR | `HX80412183319fa6623d705c2c63602d86` |
| `appointment_confirmation_v4` EN | `HX0437db24f8506f8abb670215dc17bec1` |

All submitted as UTILITY; DB rows registered with `twilioApproved=false`.
The hourly approval sync flips them on WhatsApp approval — no deploy. If
WhatsApp rejects one, the fallback chain keeps sending (nothing breaks);
fix the body in `lib/admin/whatsapp/button-templates.ts` under a new
friendly name and re-run the script.

## Deploy incident — `next/font` flake

The first VM `pnpm build` failed in `next/font/google`
(`TypeError: Cannot read properties of null (reading '1')`,
`loader.js:122` — a Google Fonts file URL came back without an extension).
A failed `next build` has already wiped `.next`; the running pm2 process
kept serving from memory, so the site stayed up. A plain rebuild passed.
**Rule:** on a failed build, rebuild immediately — never `pm2 restart` until
`BUILD_EXIT=0`.

## Not code (#5 — arrival alert)

Prod has 0/9 therapists and 0/1 doctor with a phone number, so the P62 alert
has no one to send to. Staff phones must be entered in Admin → Users.
