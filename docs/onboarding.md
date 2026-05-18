# Engineer onboarding

Per Prompt 11 §4.11.3. Welcome to Theone.pt. This document gets you
from a fresh clone to your first PR.

## Read first

1. [`docs/Theone-pt-Technical-Spec.md`](./Theone-pt-Technical-Spec.md) —
   the canonical product spec. Skim §1-4, deep-read §5 (data model)
   and §7 (RBAC).
2. [`docs/Prompt-0-Master-Context.md`](./Prompt-0-Master-Context.md) —
   the discipline list. Read all of §5 before you write code.

## Local setup

```bash
git clone <repo>
cd theone
pnpm install
cp .env.local.example .env.local       # fill in DB / Redis / S3 URLs
pnpm infra:up                          # Postgres + Redis + MinIO via Docker
pnpm db:reset                          # migrations + seed
pnpm dev                               # http://localhost:3000

# In a second terminal:
pnpm workers:start
```

Visit `http://localhost:3000/ar/style-guide` to confirm the brand
tokens loaded. Visit `http://localhost:3000/en/login` and sign in with
the dev-seed Admin (credentials printed in the seed log).

## Codebase tour

```
app/[locale]/              # Next.js App Router pages; (admin) (staff) (patient) (auth) groups
  (admin)/admin/           # Admin UI — users, rooms, settings, audit, dashboard
  (staff)/                 # Secretary + Doctor + Therapist UIs
  (patient)/patient/       # Patient portal
  (auth)/                  # Login + password change

components/                # Shared React components grouped by domain
lib/                       # All business logic — services, queries, schemas,
                           # actions, conflict engine, providers, exports, analytics
prisma/                    # schema.prisma + migrations + seed
tests/                     # Vitest specs (lib/**/__tests__) + Playwright e2e scaffolds
workers/                   # BullMQ worker processes (reminder, whatsapp, compliance)
docs/                      # This directory
```

## Patterns to follow

- **Server actions** — return `Result<T, LocalizedError>` from
  `lib/auth/result.ts`. Wrap the inner service with `withAudit`.
  Gate at the action boundary with `requirePermission(...)`.
- **Forms** — react-hook-form + Zod resolvers. The schema is the
  single source of truth; the form component reads it once and
  derives field labels via next-intl.
- **Tables** — see `app/[locale]/(admin)/admin/users` for the
  reference DataTable pattern: server-side pagination + search +
  filter, query params drive the URL.
- **Conflict engine** — _one_ file owns all conflict logic:
  `lib/appointments/conflicts.ts`. Never re-derive it elsewhere.
- **Audit** — every state-changing service function is wrapped with
  `withAudit`. The wrapper writes one `AuditLog` row per call.
- **RBAC** — `lib/rbac/can.ts` is the only place that knows which
  role can do what. Don't gate at the UI alone.
- **i18n** — every user-visible string lives in `messages/{en,ar}.json`
  and is fetched via `useTranslations('namespace')`. `pnpm i18n:check`
  enforces parity between the two catalogs.

## Patterns to avoid

- Hardcoded UI strings — break the i18n contract.
- Direct DB writes from client components — go through a server
  action.
- Conflict checks scattered outside `lib/appointments/conflicts.ts`.
- `if (provider === 'twilio')` outside `lib/whatsapp/providers/`.
- Skipping the audit wrapper on a state-changing service.
- Adding new permissions without updating
  `lib/rbac/__tests__/can.test.ts`.

## First PR

Pick a starter issue labeled `good-first-issue`. Branch from
`main`. Commits use Conventional Commits (`feat:`, `fix:`,
`refactor:`, `chore:`, `docs:`). Open the PR; CI runs typecheck,
lint, test, build, i18n, size-limit, and (post-launch) a11y +
mobile. Ask for a review from anyone in the `@theone-pt/maintainers`
team.

## Where things live for common questions

| Question                                    | Look at                                                                |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| Why is this slot unbookable?                | `lib/appointments/conflicts.ts`                                        |
| How does the recurring builder fan out?     | `lib/appointments/recurrence.ts` + `services.ts`                       |
| What permissions does the Doctor have?      | `lib/rbac/permissions.ts` (ROLE_PERMISSIONS)                           |
| How does the patient see their file?        | `app/[locale]/(patient)/patient/...`                                   |
| Why did this WhatsApp message not send?     | `lib/whatsapp/providers/` + InboxItem                                  |
| How does the dashboard compute utilization? | `lib/analytics/queries.ts`                                             |
| Where do I add a new clinic-wide setting?   | `prisma/schema.prisma` (ClinicSettings) + `lib/admin/clinic-settings/` |
