# Calendar & Appointment Workflow

Prompts 7 + 7b. Covers the secretary calendar, the conflict engine,
the cancel + change-therapist + recurring-series flows, and the
series-edit modes that ride on the existing `Appointment.seriesId`
column.

## Architecture at a glance

```
                     ┌──────────────────────────────┐
                     │  components/calendar/        │
                     │   SecretaryCalendar          │
                     │   SecretaryCalendarBoard ←─── drives modals + drops
                     │   AppointmentSidePanel       │
                     │   CancelAppointmentModal     │
                     └──────────┬───────────────────┘
                                │
                     ┌──────────▼───────────────────┐
                     │  components/appointments/    │
                     │   CreateAppointmentModal     │
                     │   CreateSeriesModal          │
                     │   ChangeTherapistModal       │
                     │   SeriesScopePicker          │
                     │   SeriesScopeConfirmDialog   │
                     └──────────┬───────────────────┘
                                │  server action
                     ┌──────────▼───────────────────┐
                     │  lib/appointments/actions.ts │
                     │   create/reschedule/cancel/  │
                     │   changeTherapist/createSeries │
                     │   previewSeries / previewSlot │
                     │   previewTherapistAvailability │
                     └──────────┬───────────────────┘
                                │
              ┌─────────────────┴─────────────────┐
              ▼                                   ▼
  lib/appointments/services.ts           lib/appointments/conflicts.ts
    createAppointment                     checkConflicts ←── single source
    rescheduleAppointment                                     of truth for
    cancelAppointment / Series                                THERAPIST_OVERLAP,
    changeAppointmentTherapist/Series                         PATIENT_OVERLAP,
    rescheduleAppointmentSeries                               THERAPIST_ON_LEAVE,
    createSeries (transactional)                              OUTSIDE_BUSINESS_HOURS,
    getTherapistAvailabilityForTimeSlot                       CLINIC_CLOSED_THIS_DAY
    previewSeries / previewSingleOccurrence
```

## Conflict engine

`lib/appointments/conflicts.ts → checkConflicts()` is the only place
that decides whether a slot is valid. Every server action that
creates or moves an appointment routes through it. The engine is a
pure read — safe to call from the live-preview endpoint on every
keystroke.

The conflict set is exhaustive, not first-match: a Friday 08:00
appointment with an overlapping booking returns BOTH
`OUTSIDE_BUSINESS_HOURS` and `THERAPIST_OVERLAP` (plus
`CLINIC_CLOSED_THIS_DAY` if Friday is in `closed: true`).

## Recurring series (Prompt 7b §4.4)

Weekly only. The user picks a first start, an interval (every N
weeks), a list of weekdays, and a count (≤ 52). `expandRecurrence` in
`lib/appointments/recurrence.ts` walks the rule and produces ordered
`PlannedOccurrence` rows. The first slot always equals the user's
chosen start — if the anchor weekday isn't in `byWeekday`, it's still
included as occurrence #1 (the user's pick is sovereign).

The Create-Series modal then calls `previewSeriesAction` which fans
out the conflict engine across every occurrence in parallel
(`Promise.all` — sequential would dominate latency at clinic scale).
For each conflicting row the UI presents four resolutions:

- **Skip** — drop this occurrence entirely.
- **Shift +1 day** — try the same time the next day.
- **Shift +1 week** — try the next pattern occurrence.
- **Override** — book despite conflicts (gated on
  `appointments.override_conflict`).

Every shift re-runs the conflict engine on the new slot via
`previewSeriesSlotAction`. A still-conflicting shift returns the row
to "Resolve" — no silent acceptance.

Save is transactional: `createSeries` re-expands the rule, re-runs
the conflict engine on every final slot inside `db.$transaction`, and
inserts every appointment with the same `seriesId`. Any single
failure aborts the entire series with the failing occurrence's index

- conflicts surfaced in the error payload.

## Cancel with categories (Prompt 7b §4.2)

Cancel always goes through the category modal — no silent defaults.
The category enum has 9 values (PATIENT_REQUEST / \_NO_SHOW / \_ILLNESS
/ \_TRAVEL, CLINIC_RESCHEDULING, THERAPIST_UNAVAILABLE, WEATHER,
INSURANCE_ISSUE, OTHER). The category drives Prompt 11 analytics; the
free-form `cancellationNotes` column (≤ 500 chars) carries the
unstructured context.

On cancel, when `notifyPatient` is on and the patient is
`whatsappReachable`, the service fires the existing
`appointment_cancelled` template via `enqueueWhatsappOutbound`. The
template's third placeholder is the localized category label.

## Change therapist + availability dots (Prompt 7b §4.6)

The picker shows every other clinician with a green/red availability
dot. The dots come from `getTherapistAvailabilityForTimeSlot` which
runs `checkConflicts` across all candidates in parallel — one source
of truth, parallel fan-out from day one.

**The dots are advisory.** The save path
(`changeAppointmentTherapist`) re-runs the engine and rejects if a
conflict has emerged between render and click.

On a successful change two distinct notifications fire:

- `APPOINTMENT_THERAPIST_REMOVED` → old therapist.
- `APPOINTMENT_THERAPIST_ASSIGNED` → new therapist.

No-op short-circuit when the picked therapist equals the current one.

## Series-edit modes (Prompt 7b §4.7)

When the touched appointment has a `seriesId` set, every mutating
flow (cancel, drag-reschedule, change-therapist) shows the
series-scope picker BEFORE confirming. The scope is passed as an
explicit `seriesMode: 'ONE' | 'FOLLOWING' | 'ALL'` parameter to the
action — there is no implicit "if seriesId exists, apply everything"
behaviour.

Semantics (Prompt 7b §4.7):

| Mode      | Affected occurrences                                           |
| --------- | -------------------------------------------------------------- |
| ONE       | Exactly the target appointment.                                |
| FOLLOWING | The target + every later occurrence in the same series.        |
| ALL       | Every active occurrence in the series, regardless of position. |

**Boundary inclusion**: FOLLOWING includes the target itself
(`startsAt >= target.startsAt`). Editing "this and following" on
occurrence #10 of a 24-occurrence series updates 15 rows, not 14.
The `series.test.ts` suite pins this down with a 24-occurrence
fixture.

Terminal-status occurrences (CANCELLED / COMPLETED / NO_SHOW) are
never re-touched by a bulk edit — they keep whatever individual
status they were transitioned to.

### Bulk atomicity

`cancelAppointmentSeries`, `rescheduleAppointmentSeries`,
`changeAppointmentTherapistSeries` all run their loops inside a
single `db.$transaction`. The reschedule + change-therapist paths
run `checkConflicts` against every in-scope occurrence inside the
transaction; if any single occurrence conflicts (without
`overrideConflicts`), the entire batch aborts via `BulkAppointmentError`
which carries a `details.failures[]` array of `{ appointmentId,
startsAt, reason, conflicts }`. No partial application.

Drag-reschedule for FOLLOWING / ALL applies the time delta (new
`startsAt` − old `startsAt`) uniformly across the in-scope
occurrences. The target's `durationMinutes` and `therapistId` are
honoured for the target only; sibling occurrences keep their own.

### Notification fan-out for bulk

- **Bulk cancel** — one WhatsApp template per occurrence, best-effort
  after commit, gated on `whatsappReachable`.
- **Bulk change-therapist** — ONE summary notification per side
  (REMOVED → old, ASSIGNED → new). The therapist isn't spammed
  with N rows.

## Permissions

Unchanged from Prompt 7 — all Prompt 7b flows ride on the existing
codes:

| Action surface                       | Permission code                  |
| ------------------------------------ | -------------------------------- |
| Create appointment / series          | `appointments.create`            |
| Reschedule, change-therapist, bulk   | `appointments.update`            |
| Cancel (single + bulk)               | `appointments.cancel`            |
| Per-occurrence OVERRIDE              | `appointments.override_conflict` |
| Series preview, availability preview | `appointments.read`              |

`lib/appointments/__tests__/rbac-prompt7b.test.ts` pins down the
matrix across all five roles (PATIENT / SECRETARY / DOCTOR /
THERAPIST / ADMIN) — 23 cells in total.

## File map

```
lib/appointments/
  actions.ts          — server actions; revalidate + route to ONE vs SERIES path
  services.ts         — single + bulk service decorated with withAudit
  schemas.ts          — Zod schemas + Input (pre-default) / Parsed types
  conflicts.ts        — checkConflicts (single source of truth)
  conflicts-time.ts   — shared DayKey constants (split from conflicts.ts)
  queries.ts          — calendar query + clinician/patient brief
  recurrence.ts       — pure expansion + +1d / +1w shift helpers
  series.ts           — selectSeriesOccurrences (ONE / FOLLOWING / ALL)
  status.ts           — STATUS_TRANSITIONS map + permission resolver
  __tests__/
    conflicts.test.ts
    status.test.ts
    cancel-schema.test.ts
    recurrence.test.ts
    series-schema.test.ts
    series.test.ts
    change-therapist-schema.test.ts
    rbac-prompt7b.test.ts

components/calendar/
  SecretaryCalendar.tsx          — react-big-calendar wrapper
  SecretaryCalendarBoard.tsx     — stateful wrapper, holds modal + drop state
  AppointmentSidePanel.tsx       — patient + appointment + actions
  CancelAppointmentModal.tsx     — category picker + scope picker

components/appointments/
  CreateAppointmentModal.tsx     — single appointment + Recurring toggle
  CreateSeriesModal.tsx          — pattern + per-occurrence resolution
  ChangeTherapistModal.tsx       — availability dots + reason + scope picker
  SeriesScopePicker.tsx          — radio group used by every series-bound modal
  SeriesScopeConfirmDialog.tsx   — pre-action dialog for drag-reschedule
```
