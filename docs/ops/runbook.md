# Operations runbook

Per Prompt 11 §4.11.1. Day-to-day procedures + incident playbook
for a single-clinic Theone.pt deployment.

## Daily

- **Backup check** — confirm last night's `pg_dump` exists in the
  off-site bucket. The cron emits a one-line success log; if
  missing, run `bash scripts/backup-now.sh` manually and
  investigate why the scheduled run missed.
- **WhatsApp delivery rate** — Admin dashboard → KPI row → no-show
  rate should be stable. A sudden spike often means a WhatsApp
  delivery issue: the patient never saw the reminder.
- **Inbox triage** — Secretary clears any overnight inbox items
  (`OUTBOUND_DELIVERY_FAILED`, `LEAVE_CONFLICT`,
  `INBOUND_RESCHEDULE_REQUEST`).

## Weekly

- **Low compliance review** — Therapist dashboard → home program
  trend. Patients < 50 % for 2+ weeks get a follow-up call.
- **Failed WhatsApp report** — `/admin/whatsapp` (when shipped) or
  the inbox `OUTBOUND_DELIVERY_FAILED` filter.
- **Audit anomalies** — `/admin/audit` filter by `DELETE` + last
  7 days. Investigate any deletion the actor can't explain.

## Monthly

- **Secret rotation** — rotate `AUTH_SECRET`, `S3_SECRET_KEY`,
  registry tokens, and the Twilio / Meta WhatsApp credentials.
  Document the rotation in the audit log as a manual entry.
- **Inactive accounts** — Admin → Users → filter by `lastLogin`
  > 60 days. Revoke staff accounts that no longer belong; archive
  > patient accounts that opted out.
- **Audit log spot check** — run a CSV export, sample 20 random
  rows, confirm the before/after snapshots make sense. Filed under
  due-diligence.

## Incident response

### WhatsApp delivery failures spike

1. Check the provider dashboard (Twilio / Meta) for outages.
2. Inspect the BullMQ `whatsappOutbound` queue depth in
   `/admin/health` (when shipped) or via `pnpm tsx
scripts/queue-stats.ts` on the VPS.
3. If the active provider is down, flip `WHATSAPP_PROVIDER` to the
   backup (`console` keeps the workflow alive while the team
   contacts patients manually) and re-deploy.

### Database slow

1. `htop` on the VPS — confirm CPU + I/O headroom.
2. Tail Postgres slow-query log:
   `docker compose logs postgres --since=10m | grep duration:`.
3. Index pressure? Run `EXPLAIN ANALYZE` on the slow query. The
   `Appointment.therapistId + startsAt` and `seriesId` indexes
   should already cover the calendar queries; if a new feature
   regresses this, add the missing index in a migration.

### Login failures spike

1. `/admin/audit` filter by `entityType=Session` last hour.
2. If the spike is real users (forgot password), the OTP tab is
   the fallback while the Admin issues temp passwords.
3. If the spike is malicious, tighten the bcrypt cost in
   `lib/auth/password.ts` or add a rate limit in front of `/login`
   (Caddy can do it via `rate_limit` directive).

### App down (5xx blanket)

1. Vercel status (Path A) or `docker compose ps` (Path B).
2. Rollback to the previous container tag — see
   [`docs/deploy/vps.md` § Rollback](../deploy/vps.md#rollback).
3. Post a status note in the clinic's internal WhatsApp group.
