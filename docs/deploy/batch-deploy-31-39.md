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
