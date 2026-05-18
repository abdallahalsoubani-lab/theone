# Architecture Overview

A bird's-eye view of how Theone.pt fits together. Read this once before
diving into a specific feature area, then refer to the per-feature
documents in [`docs/`](../README.md) for depth.

## System layers

```
                          ┌──────────────────────────────┐
       Patient phone ────▶│   WhatsApp Cloud / Twilio    │◀──── Staff phone
                          └──────────┬───────────────────┘
                                     │ webhooks + REST
                          ┌──────────▼───────────────────┐
                          │  Next.js App (App Router)    │
   Browser  ──HTTPS──▶    │  - Server Components         │
                          │  - Server Actions            │
                          │  - API routes (/api/v1/...)  │
                          │  - Edge middleware (locale,  │
                          │    auth gate)                │
                          └──────────┬───────────────────┘
                                     │
            ┌────────────────┬───────┴──────┬───────────────────┐
            ▼                ▼              ▼                   ▼
   ┌────────────────┐  ┌────────────┐  ┌──────────┐   ┌──────────────────┐
   │  PostgreSQL    │  │   Redis    │  │ S3/MinIO │   │ BullMQ workers   │
   │  - Prisma ORM  │  │  - Sessions│  │ - Uploads│   │ - reminders      │
   │  - 26 models   │  │  - BullMQ  │  │ - Direct │   │ - whatsappOutbound│
   │  - 28 enums    │  │  - Analytics│ │   PUT URL│   │ - homeReminder   │
   └────────────────┘  │    cache   │  └──────────┘   │ - complianceDaily│
                       └────────────┘                  └──────────────────┘
```

The Next.js process and the workers process share the same codebase but
run as separate Node services (`pnpm dev` + `pnpm workers:start` locally,
two Docker services in production). The web app enqueues; the workers
dequeue. Redis is the only IPC channel between them.

## Request lifecycle

Walk through a representative mutating action: **Secretary cancels a
recurring appointment, choosing scope FOLLOWING**.

1. **UI** — Secretary clicks "Cancel" in the appointment side panel.
   `CancelAppointmentModal` opens (a `ResponsiveModal` — bottom sheet on
   mobile, centered on desktop). The Secretary picks a category, types
   optional notes, leaves "Notify the patient" on, picks
   `seriesMode = FOLLOWING`.
2. **Client → server** — Modal calls
   `cancelAppointmentAction(input)` from
   `lib/appointments/actions.ts`.
3. **Action boundary**
   - `requirePermission('appointments.cancel')` reads the session,
     consults `lib/rbac/can.ts`, throws on denial.
   - `appointmentCancelSchema.safeParse(input)` Zod-validates.
   - Branches on `parsed.data.seriesMode`. `ONE` → `cancelAppointment`;
     `FOLLOWING` / `ALL` → `cancelAppointmentSeries`.
4. **Service** — `lib/appointments/services.ts → cancelAppointmentSeries`.
   - Loads the affected rows via
     `selectSeriesOccurrences({ appointmentId, mode })`.
   - Pre-flight: every row must legally transition to `CANCELLED`
     (`canTransition` from `lib/appointments/status.ts`).
   - Opens `db.$transaction(async (tx) => { ... })` and updates each row's
     status + category + reason + notes.
5. **Audit** — the service is wrapped at export with `withAudit({
entityType: 'Appointment', action: AuditAction.UPDATE, ... })`. On
   successful return the decorator writes one `AuditLog` row with the
   actor + before / after snapshots + an `event:
'APPOINTMENT_SERIES_CANCELLED'` payload listing every affected id.
6. **Side effects (post-commit)** — `cancelAppointmentReminder(id)` for
   each row removes the queued 30-minute reminder. If `notifyPatient`
   is true, `enqueueWhatsappOutbound(...)` fires one
   `appointment_cancelled` template per occurrence onto the
   `whatsappOutbound` queue. The action returns; the worker handles
   delivery + retries.
7. **Client refresh** — Action returns `Result<{ appointmentIds:
string[]; ... }, LocalizedError>`. UI toasts success, calls
   `router.refresh()`. The Secretary's calendar reflects the new state.
8. **Worker** — `workers/whatsapp.ts` picks up the queued job, calls
   the active provider via `lib/whatsapp/providers/...`, records the
   `WhatsAppMessage` row, fires an `InboxItem` on failure.

The same shape applies to every mutating flow: **action → permission +
schema → service (with audit) → optional queue → client refresh**.

## Authorization model

`lib/rbac/permissions.ts` enumerates ~70 permission codes as dotted
strings: `appointments.update`, `patients.read.assigned`, etc. Each
`UserRole` gets a `Set<PermissionCode>`; the `ROLE_PERMISSIONS` map is
the canonical matrix.

`lib/rbac/can.ts → can(user, action, resource?)` is the resolver. It
understands three scope variants:

- **Unscoped:** `appointments.update` — possessing the code is enough.
- **Owner-scoped:** `appointments.read.own` — code + `resource.ownerId
=== user.id`.
- **Assignment-scoped:** `patients.read.assigned` — code +
  `resource.assignedClinicianIds.includes(user.id)`.

Server actions gate at the boundary with `await requirePermission(...)`
(throws on denial). UI gates use the same function:
`canAny(user, ['appointments.update', 'appointments.cancel'])` decides
whether to render the menu item.

Adding a permission requires a corresponding row in
`lib/rbac/__tests__/can.test.ts` so the matrix is exhaustively pinned.

## Data model summary

`prisma/schema.prisma` (1042 lines, 26 models, 28 enums) is the single
source of truth. The major entities:

| Model                                                            | Role                                                                                |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `User` (+ `PatientProfile`)                                      | Every human in the system; `role` enum decides which dashboard they land in.        |
| `Appointment`                                                    | Single source of bookings. `seriesId` (nullable) groups recurring occurrences.      |
| `IntakeAssessment` (+ `AdultIntakeData` / `PediatricIntakeData`) | Intake parent + age-specific detail.                                                |
| `TreatmentPlan`                                                  | Doctor-authored; versioned via `parentPlanId`; supports `PROPOSED` → `ACTIVE` flow. |
| `SessionNote` (+ addenda)                                        | SOAP notes per appointment; immutable after 24h except via addendum chain.          |
| `HomeProgramItem` (+ `HomeProgramCompletion`)                    | Per-patient exercise schedule + per-day completion log.                             |
| `Exercise`                                                       | Curated library, versioned via `replacedById`.                                      |
| `WhatsAppMessage` (+ `WhatsAppTemplate`)                         | Provider-agnostic message record.                                                   |
| `InboxItem`                                                      | Secretary's triage queue for delivery failures + inbound + leave conflicts.         |
| `Notification`                                                   | In-app fan-out for clinical events.                                                 |
| `AuditLog`                                                       | Append-only history of every state change.                                          |
| `Leave`                                                          | Staff leave requests; approved leaves drive the calendar overlay.                   |
| `ClinicSettings`                                                 | Singleton row (`id = "default"`) holding business hours, default language, etc.     |

The `Appointment.seriesId` column is the join key for every series-edit
operation. The conflict engine reads `ClinicSettings.businessHours` on
every booking. The audit log indexes on `(entityType, entityId)` so the
audit viewer can scope to one entity quickly.

## Background processing

`workers/index.ts` spawns one worker per queue at process start:

- **`reminders`** — appointment reminder 30 min before each scheduled
  start (`workers/reminder.ts`). One-shot jobs scheduled at create /
  reschedule, removed at cancel.
- **`whatsappOutbound`** — the single chokepoint for every outbound
  WhatsApp message (`workers/whatsapp.ts`). OTP, confirmations,
  cancellations, home-exercise reminders, low-compliance nudges all
  enqueue here so retries + audit + rate limiting are uniform.
- **`complianceDailyCheck`** — recurring cron at 18:00 Asia/Amman
  (`workers/complianceDailyCheck.ts`). Scans active home programs and
  emits `LOW_COMPLIANCE` notifications to the responsible therapist
  when 7-day adherence drops below threshold.
- **`homeReminder`** — per-`HomeProgramItem` recurring job
  (`workers/homeReminder.ts`). Cron pattern derived from
  `daysOfWeek` + `scheduledTime` − `HOME_REMINDER_OFFSET_MINUTES`.

BullMQ `repeat.tz` is `Asia/Amman` so cron fires at clinic local time
regardless of where the worker process runs.

## Internationalization

next-intl with locale always prefixed (`/{ar,en}/...`). Arabic is the
default locale; the root layout sets `<html dir="rtl" lang="ar">` when
the locale is `ar`. CSS uses logical properties
(`margin-inline-start`, `border-inline-end`) so a single stylesheet
mirrors correctly under both locales.

Message keys live in `messages/en.json` + `messages/ar.json`. The
`scripts/check-i18n-sync.ts` script (run as `pnpm i18n:check`) is a CI
gate that asserts the two catalogs hold the same set of dotted key
paths — adding a key in one without the other fails the build.

Date formatting: `lib/format/date.ts` exposes `formatDate`, `formatTime`,
and `formatDateTime`. Each accepts an `intlLocale: 'en' | 'ar'`
parameter and honors the patient's `hijriCalendarPref` when relevant.

## Audit trail

Every state-changing service function is wrapped at export with
`withAudit({ entityType, action, extractEntityId, extractBefore?,
extractAfter? }, async function inner(...) {...})`. The decorator from
`lib/audit/withAudit.ts`:

1. Runs `extractBefore` (if provided) to capture the pre-state.
2. Calls the inner function.
3. If the call succeeds (no throw), pulls the actor from the session
   (or an explicit `actorOverride`) and writes one `AuditLog` row.
4. If the audit insert itself fails, logs to stderr — never breaks the
   user-visible operation.

The `AuditLog.after` JSONB column carries an event tag plus any payload
the service wanted recorded — for example, the bulk-cancel after
snapshot lists every affected appointment id so a single audit row can
be navigated back to the operation in full. The `/admin/audit` viewer
paginates server-side and streams CSV exports so even very large
audit histories stay tractable.

## File storage

Direct browser-to-S3 uploads via presigned PUT URLs from
`lib/storage/presign.ts`. The browser hits the API to request a URL,
the API resolves access + generates the signed URL (5-minute TTL), the
browser PUTs the file straight to S3 / MinIO. Nothing transits the
Next.js process. Public reads use `env.S3_PUBLIC_BASE_URL` (CDN in
prod; the MinIO endpoint locally) so the browser never sees S3 sign
URLs for reads.

MinIO is configured with `forcePathStyle: true` locally; AWS S3 uses
the default virtual-host style in production.

## WhatsApp abstraction

One interface, three implementations:

```
lib/whatsapp/
  factory.ts            Reads env.WHATSAPP_PROVIDER → picks implementation
  providers/
    console.ts          Dev stub — logs structured payload to stderr
    twilio.ts           Twilio Sandbox + Production
    meta.ts             Meta Cloud API (production)
  templates.ts          Logical template registry + parameter shapes
```

Callers always go through the factory and the typed `Provider`
interface — no `if (provider === 'twilio')` branches outside this
directory. Switching providers in production is an env change + a
worker restart; no code edit.

Inbound webhooks live at
`app/api/v1/whatsapp/webhook/{twilio,meta}/route.ts` and verify the
provider's signature before processing. Failed delivery rows land in
the Secretary's `InboxItem` queue (`OUTBOUND_DELIVERY_FAILED`).

## Where to dig deeper

- Conflict engine: [`docs/calendar/README.md`](../calendar/README.md)
- WhatsApp provider details:
  [`docs/whatsapp/setup-twilio.md`](../whatsapp/setup-twilio.md) +
  [`setup-meta.md`](../whatsapp/setup-meta.md)
- Home program reminder cron:
  [`docs/home-program/README.md`](../home-program/README.md)
- Database design rationale:
  [`docs/db/schema.md`](../db/schema.md)
- Audit guarantees:
  [`docs/audit/README.md`](../audit/README.md)
- RBAC patterns:
  [`docs/auth/README.md`](../auth/README.md)
