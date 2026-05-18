# Disaster recovery

Per Prompt 11 §4.11.2.

## Targets

- **RPO (recovery point objective)** — 24 hours. The last successful
  daily backup is the worst-case state we recover to.
- **RTO (recovery time objective)** — 4 hours. Acceptable for a
  single-clinic deployment where the team can switch to paper for
  half a day if necessary.

## Backup procedure

A cron on the VPS runs nightly at 02:00 Asia/Amman:

```bash
#!/bin/bash
set -euo pipefail
TS=$(date +%Y%m%d_%H%M%S)
docker compose exec -T postgres pg_dump -U theone theone | \
  gzip > /tmp/theone-$TS.sql.gz
rclone copy /tmp/theone-$TS.sql.gz remote:theone-backups/
find /tmp -name 'theone-*.sql.gz' -mtime +2 -delete
```

The `remote:` is a Backblaze B2 / Wasabi bucket — a different
provider than the primary storage on purpose.

Retention: 30 daily, 12 monthly, 5 yearly.

## Verification

- **Weekly automated** — Sunday 04:00 a tiny VM pulls the latest
  backup, runs `pg_restore` into a sandbox Postgres, runs the
  Prisma migration check, and emits a one-line success log. A
  silent failure is the worst outcome — alert if no log appears.
- **Quarterly manual** — once a quarter the project owner walks
  through the full restore procedure below end-to-end against a
  fresh VPS. Treat it like a fire drill.

## Total loss procedure

Recovery from a complete cluster failure (server gone, region down):

1. Provision a fresh VPS — same OS image, follow
   [`docs/deploy/vps.md`](../deploy/vps.md) §1-3.
2. Pull the latest backup:
   ```bash
   rclone copy remote:theone-backups/theone-<latest>.sql.gz /tmp/
   gunzip /tmp/theone-<latest>.sql.gz
   docker compose up -d postgres
   cat /tmp/theone-<latest>.sql | docker compose exec -T postgres psql -U theone -d theone
   ```
3. Restore the MinIO bucket from its mirror:
   ```bash
   mc mirror remote:theone-media-backups/ local-minio/theone-media/
   ```
4. `docker compose up -d` brings the rest of the stack up.
5. Run `pnpm prisma migrate deploy` against the restored database.
6. Cut DNS over to the new VPS.

Estimated total wall-clock time: **2–3 hours** for a practiced
operator. The quarterly manual rehearsal keeps the muscle memory.

## Data export on request (Spec §13)

For an individual patient's right-of-access request:

1. Patient logs into `/patient/profile` and clicks "Download my file"
   — produces a PDF with profile + intake + appointments + home
   program. (Already audited as READ_SENSITIVE.)
2. For a machine-readable export: the Admin runs
   `pnpm tsx scripts/export-patient-json.ts --patient <id>` (TODO —
   build when first requested; the data shape is documented in
   `lib/exports/patientFile.tsx`).
