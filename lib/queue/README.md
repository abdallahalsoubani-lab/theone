# `lib/queue`

BullMQ queues for WhatsApp sends, scheduled reminders, end-of-day report generation.
Owned by **Prompt 8 — WhatsApp Integration**.

## Appointment reminders vs. dispatch control (P48 / P50, series 45+)

Two separate flows share the `reminders` queue + worker; neither knows about the other:

| Flow                                                                  | Jobs                                                                       | Controlled by                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P17 24h reminder** — `appointment-reminder-{id}`                    | one per reminded appointment, start − offset, clamped to the clinic window | `ClinicSettings.defaultReminderOffsetMinutes` / `reminderWindow*` only. **Never** by the dispatch modes — reminders keep firing even when every dispatch type is MANUAL (owner decision, P50).                                                                                                                                                             |
| **P48 dispatch** — `confirm-{id}` / `resched-{id}` / `cancelmsg-{id}` | booking / reschedule / cancellation messages                               | `lib/whatsapp/dispatch/service.ts → recordDispatchEvent`. AUTO = deferred job with the admin delay; **MANUAL = the entry parks in the outbox and NOTHING leaves until the admin presses Send — no proximity exception** (the <24h bypass was removed 19 Aug 2026, `6866483`). The outbox "starts within 24h" badge is visual only (`dispatch/urgency.ts`). |

### Recurring series rules (P50)

- **One booking confirmation per series**, anchored to the earliest row (`createSeriesBatch`, Amendment 46.1). Same day or across days, AUTO or MANUAL: one send / one outbox row. Cancelling the anchor before it left re-anchors the pending confirmation to the next surviving occurrence (`cancelAppointment`); cancelling the whole series before anything left is a silent close.
- **Reminders: one per clinic-local day.** Every day of a multi-day series gets its own 24h reminder; several occurrences on the **same Asia/Amman day share one** — the earliest (`lib/appointments/reminderWindow.ts → pickSeriesReminderTargets`, pure).
- **Inheritance:** cancelling or moving a series occurrence re-runs the dedup for the affected day(s) (`services.ts → resyncSeriesDayReminders`): the next same-day sibling inherits the reminder; if its lead time is already under the offset the P17 late-booking rule applies (send now inside the window, else next opening, else skip). Whole-series cancel (`FOLLOWING`/`ALL`) leaves no later survivors, so it needs no resync.
- **Series cancel message:** ONE cancellation about the nearest upcoming occurrence (P53), never N.
