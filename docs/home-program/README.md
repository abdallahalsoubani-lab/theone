# Home Program & Exercise Library

Prompt 10 surface. Covers what the patient does between clinic visits:
the curated Exercise Library, the per-patient Home Program, the
patient portal, the WhatsApp recurring reminders, and the daily
low-compliance scan that nudges the therapist.

## Architecture at a glance

```
Therapist                   Patient                   Workers
─────────                   ────────                  ────────
 /clinical/exercises        /patient/home-program     reminders queue
 /therapist/patients/[id]/                            ├─ appointment reminder
   home-program/edit                                  ├─ homeExerciseReminder ─┐
                                                      └─ complianceDailyCheck  │
                                                                                ▼
                                                                       whatsappOutbound
                                                                       queue → Twilio/Meta
```

Every HomeProgramItem owns one BullMQ recurring job. When the cron
fires, the worker enqueues a `home_exercise_reminder` template onto
the `whatsappOutbound` queue — the outbound worker from Prompt 8
handles provider calls + retries + audit.

## Exercise Library versioning

Editing an exercise creates a new row at `version+1` and sets
`replacedById` on the old row. Existing `HomeProgramItem`s + `PlanExercise`s
continue to reference the version they were assigned (the FK has no
cascade). The library list filters out superseded rows
(`replacedById IS NULL`) so therapists only see one current entry
per exercise.

Soft delete (`active=false`) is Admin-only. Archived exercises stay
referenced by historical HomeProgramItems; new items can't pick them.

## Reminder cron — timezone + previous-day rollover

`computeReminderCron` in `lib/queue/jobs/homeExerciseReminder.ts`
applies the `HOME_REMINDER_OFFSET_MINUTES` offset (default 30) to
the patient-facing scheduled time. When the offset pushes the
trigger to the previous calendar day (e.g., a 00:15 exercise minus
30 minutes lands at 23:45 the previous day), the day-of-week
selector shifts accordingly. BullMQ's `repeat.tz` is set to
`Asia/Amman` so the cron fires at local clinic time regardless of
where the worker process runs.

Tests in `lib/queue/__tests__/homeExerciseReminder.test.ts` cover
the standard path, hour-boundary cross, previous-day rollover,
Sunday wrap, dedup of shifted days, and a custom 60-minute offset.

## Compliance calculation

`calculateCompliance` (lib/clinical/compliance/calculate.ts) walks
active items × the rolling window. For each item it enumerates
scheduled occurrences in `[max(windowStart, item.createdAt), today]`
and counts matching `HomeProgramCompletion` rows. The `createdAt`
clamp prevents a freshly assigned program from showing 0% overnight.

`overdue` counts scheduled occurrences in the last 2 days that have
no matching completion — used by the Therapist dashboard's "Patients
with low compliance" widget.

Returns `rate: null` when the patient has no active items. The
clinician UI renders "No program" rather than 0%.

## Daily low-compliance scan

`workers/complianceDailyCheck.ts` registers a single BullMQ
recurring job at `0 18 * * *` Asia/Amman. Each tick:

1. Lists all patient profiles with an assigned therapist.
2. Computes the patient's 7-day compliance.
3. If `rate < 0.5` and no `LOW_COMPLIANCE` notification for the
   same `(therapist, patient)` pair has been created in the last
   3 days, creates one.

The 3-day cooldown is the difference between "actionable signal"
and "spam". Tune via the worker arguments if a clinic's preference
differs; defaults match Prompt 10 §4.8.3.

## Storage

Media (image / video) lives in S3 / MinIO under `exercises/img/*`
and `exercises/video/*`. See `docs/storage/README.md` for the
upload constraints, the production AWS swap, and the bucket policy.

## Manual end-to-end check

Workers + dev server + MinIO + Postgres + Redis all need to be up:

```bash
pnpm db:reset
pnpm infra:up        # Postgres + Redis + MinIO + applies bucket policy
pnpm dev
pnpm workers:start
```

Then:

1. Therapist logs in, `/clinical/exercises/new`, uploads a short MP4
   - thumbnail, saves. Confirm the row in Prisma Studio + the file
     in the MinIO console.
2. `/therapist/patients/[id]/home-program/edit`, add an item scheduled
   ~35 minutes in the future. Confirm the BullMQ repeat job
   in `redis-cli> KEYS bull:reminders:repeat:*`.
3. Patient logs in, `/patient/home-program`, sees today's exercise
   if today's a scheduled day. Mark done; pain score; refresh.
4. Wait for the cron to fire. Watch the worker log; you should
   see a `[home-reminder] enqueued outbound for item=…` line and
   a `[whatsapp.outbound]` line.
5. The patient (if Sandbox-joined) receives the message. Reply
   "نعم" — handled by the Prompt 8 inbound parser, which currently
   doesn't attach to home-exercise notifications. That's expected.

## Out of scope

- Server-side transcoding — Prompt 11 / polish if real users complain.
- Patient-uploaded videos — out of v1.
- Adaptive streaming, image thumbnails, antivirus scanning,
  cross-patient analytics — all explicitly deferred (§3).

## Failure modes to keep in mind

- **Redis is down at item creation**: the row exists but no cron is
  registered. The cron-registration call is wrapped in try/catch so
  the request returns 200. The next day's compliance check will
  show a 0% rate for the patient and the Therapist gets the low-
  compliance notification — surfaces the gap.
- **Patient is unreachable on WhatsApp**: the home-reminder worker
  re-reads the patient + skips when `whatsappReachable=false`. The
  patient profile WhatsApp section (Prompt 8) shows the failure
  reason; the Secretary triages from the inbox.
- **Therapist edits an exercise mid-program**: the existing item
  keeps using the old version because `replacedById` doesn't cascade
  into HomeProgramItem.exerciseId. New items pick the latest version.
