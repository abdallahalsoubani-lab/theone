# Production deployment — Path A (Managed services) — alternative

Not chosen for v1; Path B (VPS + Docker Compose) is the active path.
This document is kept for future reference if the clinic ever wants
to migrate to managed services.

## Stack

- **App hosting** — Vercel (auto-deploy from `main`)
- **Database** — Neon Postgres (branch-per-PR for staging)
- **Redis** — Upstash (serverless)
- **Storage** — AWS S3 (eu-central-1 Frankfurt or me-south-1 Bahrain) + CloudFront
- **Workers** — Railway / Fly.io running `pnpm workers:start`

Approximate monthly cost at low traffic: **$65–115 USD**.

## Migration path from VPS to managed

1. Take a `pg_dump` of the VPS database; restore into Neon via `pg_restore`.
2. Mirror the MinIO bucket to S3 via `mc mirror` (MinIO Client).
3. Flip the application's `DATABASE_URL`, `REDIS_URL`, and `S3_*`
   envs in Vercel project settings.
4. Cut over DNS to Vercel's edge.
5. Decommission the VPS once the new path has been stable for a
   week and the audit log shows clean activity.

## Vercel-specific notes

- `pnpm prisma migrate deploy` runs as a pre-build step in
  `vercel-build` rather than in CI.
- The `workers` process must run elsewhere — Vercel functions are
  not long-running. Railway is the simplest option.
- WhatsApp webhooks need a public URL that can survive Vercel cold
  starts; for production traffic prefer a small dedicated function
  region close to the workers.
