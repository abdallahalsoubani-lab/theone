#!/usr/bin/env bash
#
# One-shot bucket creation for the MinIO container started by docker-compose.
# Idempotent: re-runs are no-ops once the bucket exists.
#
# Picked up by `pnpm infra:up`.

set -euo pipefail

# Load .env.local if present (does not override an explicitly-set environment)
if [ -f .env.local ]; then
  # shellcheck disable=SC1091
  set -a; . ./.env.local; set +a
fi

BUCKET="${S3_BUCKET:-theone-uploads}"
ENDPOINT="${S3_ENDPOINT:-http://localhost:9000}"
ACCESS_KEY="${S3_ACCESS_KEY_ID:-${MINIO_ROOT_USER:-minio_admin}}"
SECRET_KEY="${S3_SECRET_ACCESS_KEY:-${MINIO_ROOT_PASSWORD:-minio_admin_change_me}}"

echo "[init-minio] waiting for MinIO at ${ENDPOINT}..."
for _ in $(seq 1 30); do
  if curl -fsS "${ENDPOINT}/minio/health/live" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "[init-minio] ensuring bucket '${BUCKET}' exists"
docker run --rm --network host \
  -e MC_HOST_local="http://${ACCESS_KEY}:${SECRET_KEY}@${ENDPOINT#http://}" \
  minio/mc:latest \
  sh -c "mc mb --ignore-existing local/${BUCKET} && mc anonymous set download local/${BUCKET} >/dev/null 2>&1 || true"

echo "[init-minio] done"
