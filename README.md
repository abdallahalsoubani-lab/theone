# Theone.pt

> Bilingual (English + Arabic, RTL-first) physiotherapy clinic management
> system for **The One for Physiotherapy** (المركز الأول للعلاج الطبيعي),
> Amman, Jordan.

A complete clinic platform covering the full patient journey — registration,
intake assessment, treatment planning, appointment scheduling, SOAP session
notes, home-exercise programs, and compliance tracking — with WhatsApp as
the primary patient communication channel. Built for a single clinic of
5-10 staff and a few hundred active patients.

---

## Status

**v1.0 — feature complete.** The system was built across 12 sequential
prompts (`docs/prompts/`) covering foundation through launch readiness.
912 tests passing, 1,087 i18n keys EN+AR in sync, 8 database migrations.

See [`CHANGELOG.md`](CHANGELOG.md) for the full release notes and
[`docs/backlog.md`](docs/backlog.md) for the explicit deferrals.

---

## Tech stack

- **Framework:** Next.js 15 (App Router) + React 19 + TypeScript strict
- **Database:** PostgreSQL 16 + Prisma 6
- **Auth:** Auth.js v5 with Credentials + Phone-OTP providers
- **i18n:** next-intl (EN + AR with full RTL)
- **Background jobs:** BullMQ + Redis
- **Calendar:** react-big-calendar
- **PDF:** @react-pdf/renderer
- **Storage:** AWS SDK v3 (MinIO locally, S3 in production)
- **Charts:** Recharts
- **Tests:** Vitest + Playwright

The stack is deliberately tight. See [`CLAUDE.md`](CLAUDE.md) for the
locked dependencies and the rationale.

---

## Prerequisites

- Node.js 20 LTS (Node 22 also supported); see `.nvmrc`
- pnpm 10 (pinned in `package.json`'s `packageManager`)
- Docker Desktop or Docker Engine + Compose (for local Postgres + Redis + MinIO)
- (Optional) ngrok or similar for WhatsApp webhook testing against a public URL

---

## Quick start

```bash
git clone <repo-url> theone && cd theone
cp .env.example .env.local
pnpm install
pnpm infra:up         # Postgres + Redis + MinIO via docker compose
pnpm db:reset         # apply migrations + seed reference + dev data
pnpm dev              # Next.js on http://localhost:3000

# in a second terminal:
pnpm workers:start    # BullMQ workers for reminders + WhatsApp + compliance scan
```

Then visit:

- <http://localhost:3000/ar> — landing page (Arabic, RTL — default locale)
- <http://localhost:3000/en/login> — sign in (English)
- <http://localhost:9001> — MinIO console (`minio_admin` / `minio_admin_change_me`)

### Dev credentials

Loaded by the Tier 2 seed; **never present in production**.

| Role         | Email                                                  | Password                      |
| ------------ | ------------------------------------------------------ | ----------------------------- |
| Admin        | `admin@theone.pt`                                      | `Admin@123`                   |
| Doctor       | `dr.sara@theone.pt`                                    | `Doctor@123`                  |
| Secretary    | `secretary@theone.pt`                                  | `Reception@123`               |
| Therapists   | `ahmad@theone.pt`, `layan@theone.pt`, `omar@theone.pt` | `Therapist@123`               |
| Patients (8) | `*@example.com` or phone                               | `Patient@123` (forces change) |

The first production Admin is created via
[`pnpm bootstrap:admin`](scripts/bootstrap-admin.ts) on a clean database.

---

## Available scripts

| Command                                                            | Purpose                                                    |
| ------------------------------------------------------------------ | ---------------------------------------------------------- |
| `pnpm dev`                                                         | Next.js dev server on port 3000                            |
| `pnpm build`                                                       | Production build                                           |
| `pnpm start`                                                       | Run the production build                                   |
| `pnpm typecheck`                                                   | Strict TypeScript, no emit                                 |
| `pnpm lint` / `pnpm lint:fix`                                      | ESLint (zero warnings tolerated)                           |
| `pnpm format` / `pnpm format:check`                                | Prettier write / verify                                    |
| `pnpm test` / `pnpm test:watch`                                    | Vitest one-shot / watch                                    |
| `pnpm i18n:check`                                                  | EN + AR translation-key parity                             |
| `pnpm size-limit`                                                  | 200 kB gzipped first-load JS budget                        |
| `pnpm infra:up` / `down` / `reset`                                 | docker-compose lifecycle                                   |
| `pnpm db:migrate` / `migrate:deploy` / `reset` / `seed` / `studio` | Prisma helpers                                             |
| `pnpm workers:start`                                               | Spawn the BullMQ workers (reminders, WhatsApp, compliance) |
| `pnpm bootstrap:admin`                                             | One-shot first-Admin creator (production only)             |

---

## Project structure

```
app/[locale]/        Next.js App Router; locale always prefixed
  (admin)/admin/     Admin UI — users, rooms, settings, audit, dashboard, leaves
  (staff)/           Secretary + Doctor + Therapist UIs
  (patient)/patient/ Patient portal
  (auth)/            Login + password change
  api/v1/            Internal API routes (webhooks, exports, presigned URLs)
components/          React components, colocated by feature
lib/                 Domain logic — actions, queries, schemas, services
prisma/              schema.prisma + 8 migrations + 2-tier seed
workers/             BullMQ worker entrypoints
messages/            EN + AR i18n catalogs
docs/                Per-feature documentation — see docs/README.md
tests/               Playwright e2e scaffolds (a11y + mobile)
scripts/             Operational scripts (bootstrap, i18n check, MinIO init)
```

Unit tests live next to source: `lib/foo/__tests__/foo.test.ts`.

---

## Documentation

Start with the [documentation index](docs/README.md). Highlights:

- **[`CLAUDE.md`](CLAUDE.md)** — project context loaded by AI assistants.
  Lists the conventions, anti-patterns, and quality gates.
- **[`docs/onboarding.md`](docs/onboarding.md)** — new-engineer walkthrough,
  clone to first PR.
- **[`docs/architecture/overview.md`](docs/architecture/overview.md)** —
  high-level system design + request lifecycle.
- **[`docs/ops/runbook.md`](docs/ops/runbook.md)** — daily / weekly /
  incident procedures.
- **[`docs/deploy/vps.md`](docs/deploy/vps.md)** — production deployment
  walkthrough (Path B — VPS + Docker Compose). Path A (managed Vercel +
  Neon + Upstash) lives at [`docs/deploy/managed.md`](docs/deploy/managed.md).
- **[`docs/Theone-pt-Technical-Spec.md`](docs/Theone-pt-Technical-Spec.md)** —
  the original 50 KB design specification.
- **[`docs/prompts/`](docs/prompts/)** — the 12 prompt specifications that
  built this system in order.

---

## Brand identity

Eleven brand tokens are wired into Tailwind (`bg-brand-navy`,
`text-brand-cyan`, …) and into `globals.css` as CSS variables
(`var(--brand-navy)`) so they work in inline styles, SVGs, and dynamic
content alike. The palette is **locked** — see
[`docs/Prompt-0-Master-Context.md`](docs/Prompt-0-Master-Context.md) §4.1.

The logo files in `/public` are **placeholders** until the clinic supplies
the production assets. See [`public/README.md`](public/README.md) for the
swap procedure.

---

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). For AI assistants, the
authoritative pattern guide is [`CLAUDE.md`](CLAUDE.md).

Quality gates run via Husky pre-commit on staged files and again in CI
against the full tree.

---

## License

Clinic-internal for v1. Public-release licensing to be decided by the
project owner.
