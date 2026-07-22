# Batch-deploy checklist — Prompts 31→39

Deploys are batched for this bug-fix series (owner decision): nothing below
has been applied to the VM. Execute this list top-to-bottom on deploy day,
after `git pull` + build + `pm2 restart`. Each prompt appends its own
deploy-time actions here.

## From Prompt 31 (timezone)

1. **pm2 process timezone** (belt-and-suspenders; code is correct without it):
   add to the pm2 ecosystem file for BOTH `web` and `workers` apps, then
   `pm2 restart all --update-env`:

   ```text
   env: { TZ: 'Asia/Amman' }
   ```

## From Prompt 32 (storage/uploads)

2. **nginx upload ceiling** — the exercise-video limit is now 100 MB, so the
   55m location ceiling must rise. In
   `/etc/nginx/sites-available/theonephysio.com.conf`, change the
   `/api/v1/storage/` location line:

   ```nginx
   # before
   client_max_body_size 55m;
   # after (100 MB payload + headroom)
   client_max_body_size 105m;
   ```

   then `sudo nginx -t && sudo systemctl reload nginx`.

3. **MinIO service** — verify it is running and enabled (it was restored
   2026-07-21; confirm it survived reboots):

   ```bash
   systemctl is-enabled minio && systemctl is-active minio
   ss -tlnp | grep :9000        # expect 127.0.0.1:9000
   ```

4. **Bucket exists** (idempotent — safe to re-run):

   ```bash
   # mc alias uses the S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY from ~/theone/.env
   mc alias set local http://127.0.0.1:9000 "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY"
   mc mb --ignore-existing local/theone-uploads
   ```

5. **Env vars** — `~/theone/.env` (and `.env.local`) must contain, pointing at
   the local MinIO: `S3_ENDPOINT` (`http://127.0.0.1:9000`), `S3_REGION`,
   `S3_BUCKET` (`theone-uploads`), `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
   All five were present at the 2026-07-22 read-only inspection — just confirm
   after any env edits.

6. **CORS: none needed.** Uploads and reads go through the same-origin proxy
   `/api/v1/storage/…`; the browser never talks to MinIO directly.

7. **Owner decision (flagged, not decided):** stay on VM-local MinIO vs move
   production storage to real S3/GCS. MinIO-on-the-box means backups must
   include `/var/lib/minio` (or the configured data dir) and the box is a
   single point of loss for patient documents. Real S3 changes only env vars
   (`S3_ENDPOINT` unset, AWS creds set) — no code change required.

8. **Smoke test after deploy:** as a doctor, create an exercise with a >10 MB
   MP4 **and** an iPhone MOV; as a secretary, upload a PDF to a patient's
   Documents tab and download it back. Stop `minio` briefly → the UI must say
   the localized "storage unavailable" message, not the generic one; restart.

## From Prompt 38 (config bundle)

9. **Default session duration 60 min (NI-9)** — the SEED now says 60, but the
   production `ClinicSettings` row already exists with 30. One idempotent data
   update (NOT a schema migration; no prisma migrate step):

   ```bash
   sudo -u postgres psql -d theone -c \
     "UPDATE \"ClinicSettings\" SET \"defaultAppointmentDuration\"=60 WHERE id='default' AND \"defaultAppointmentDuration\"=30;"
   ```

   (The Admin can equally set it from /admin/settings — the field is
   settings-driven; this just saves them the click.)

10. **New clinic logo (NI-11): DEFERRED** — no SVG asset was provided in
    Prompt 38. When the owner ships it, follow public/README.md's swap
    procedure (logo.svg + logo-dark.svg) and re-verify header/login/kiosk/
    display/PDF surfaces; nothing was touched meanwhile.

## From Prompt 39 addendum (owner decisions)

11. **MinIO data backup (storage stays on MinIO — owner ruling).** The VM is
    the SINGLE copy of patient documents; back the object store up alongside
    the database in every backup routine. Discover the data dir once, then
    tar it:

    ```bash
    systemctl cat minio | grep ExecStart     # shows the data directory arg
    # e.g. if the data dir is /var/lib/minio:
    sudo tar -czf ~/backup-minio-$(date +%F).tar.gz -C / var/lib/minio
    ```

    Run it in §4 of Prompt 39 right after `pg_dumpall`, and add both to the
    weekly runbook backup step (docs/ops/runbook.md).

12. **A-20 (owner ruling): Act-As hidden + server-rejected for PATIENT
    targets** — code change in the batch (canActAsTarget); nothing to run at
    deploy time, listed here so QA's re-test sheet expects the new behavior.

13. **Doctor dashboard now shows ALL clinic appointments** (owner ruling c) —
    behavior change only; tell QA the NI-1 expectation changed.

14. **Prompt 43 — DB migration required (`prisma migrate deploy`).** The
    batch's only schema change: `20260723100000_home_program_doctor_edited_notification`
    adds the `HOME_PROGRAM_DOCTOR_EDITED` value to the `NotificationType`
    enum (NI-6 — the therapist now gets an in-app notification when a doctor
    edits a home program). Pure `ALTER TYPE ... ADD VALUE`; no data backfill,
    no downtime. Runs automatically with the standard migrate step — listed
    so nobody assumes the batch is migration-free.

15. **Prompt 43 UX changes for QA's re-test sheet:** the doctor sidebar tab is
    now labeled "موافقات البرامج المنزلية / Home-program approvals" with a
    pending-count badge (NI-7); the therapist's builder shows an explainer on
    PENDING status — the submit button is intentionally absent there (P-2:
    submit exists on DRAFT/CHANGES_REQUESTED only).
