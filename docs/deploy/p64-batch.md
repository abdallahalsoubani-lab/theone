# P64 batch — owner's 17 items (one deploy)

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

## Not code (#5 — arrival alert)

Prod has 0/9 therapists and 0/1 doctor with a phone number, so the P62 alert
has no one to send to. Staff phones must be entered in Admin → Users.
