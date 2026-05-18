#!/usr/bin/env bash
#
# One-shot bucket creation + policy bootstrap for the MinIO container
# started by docker-compose. Idempotent: re-runs are no-ops once the
# bucket exists.
#
# Picked up by `pnpm infra:up`.
#
# Bucket layout (Prompt 10 §4.2.4):
#   exercises/img/{userId}/{date}/{uuid}.{ext}    — exercise images
#   exercises/video/{userId}/{date}/{uuid}.{ext}  — exercise videos
# The exercises/ prefix has public-read so the patient browser renders
# media directly via the public URL without signed-URL gymnastics.

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

# Policy doc: read-only on the exercises/* prefix. Other prefixes stay
# private. Production swap to AWS uses the equivalent bucket policy via
# `aws s3api put-bucket-policy` or Terraform.
POLICY_FILE="$(mktemp)"
cat > "${POLICY_FILE}" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "AWS": ["*"] },
      "Action": ["s3:GetObject"],
      "Resource": ["arn:aws:s3:::${BUCKET}/exercises/*"]
    }
  ]
}
EOF

echo "[init-minio] ensuring bucket '${BUCKET}' exists + applying exercises/* read policy"
docker run --rm --network host \
  -v "${POLICY_FILE}:/policy.json:ro" \
  -e MC_HOST_local="http://${ACCESS_KEY}:${SECRET_KEY}@${ENDPOINT#http://}" \
  minio/mc:latest \
  sh -c "mc mb --ignore-existing local/${BUCKET} && (mc anonymous set-json /policy.json local/${BUCKET} >/dev/null 2>&1 || mc anonymous set download local/${BUCKET} >/dev/null 2>&1 || true)"

rm -f "${POLICY_FILE}"
echo "[init-minio] done"
