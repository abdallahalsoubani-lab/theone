# CLAUDE.md — Project Context for AI Assistants

This file is read automatically by Claude Code (and other agentic AI tools) at
the start of each session on this repository. It encodes the conventions,
patterns, and constraints established across 12 sequential prompts of build
work. The codebase is feature-complete; this file exists to keep future work
inside the rails the project owner already chose.

---

## What is Theone.pt

A bilingual (English + Arabic, full RTL) physiotherapy clinic management web
application for **The One for Physiotherapy** (المركز الأول للعلاج الطبيعي)
in Amman, Jordan. Built as a single-clinic deployment for 5–10 staff and a
few hundred active patients; multi-tenant is explicitly v2.

The product covers the full patient journey: registration → intake assessment
→ treatment plan → scheduled appointments → SOAP session notes → home exercise
program → compliance tracking. WhatsApp is the primary patient communication
channel — confirmations, reminders, OTP login, low-compliance nudges — through
a provider abstraction that supports Console (dev), Twilio Sandbox (CI), and
Meta Cloud API (production) without code changes.

Five roles share the system: **Admin**, **Doctor**, **Therapist**,
**Secretary**, **Patient**. Each has its own dashboard, navigation, and
permission scope. The Secretary's calendar is the operational hub — every
mutating flow (drag-reschedule, cancel, change-therapist, recurring create)
runs through one conflict engine that's the single source of truth for slot
availability.

---

## Tech stack (locked — do not deviate without explicit user approval)

Adding or swapping any of these requires the owner's sign-off:

- **Runtime:** Node.js 20 LTS (Node 22 also supported), pnpm 10
- **Framework:** Next.js 15 App Router + React 19 + TypeScript strict mode
- **Styling:** Tailwind CSS + shadcn/ui (brand tokens locked in `tailwind.config.ts`)
- **Data:** PostgreSQL 16 + Prisma 6 (26 models, 28 enums, 8 migrations)
- **Auth:** Auth.js v5 beta with Credentials + Phone-OTP providers (`lib/auth/`)
- **i18n:** next-intl (AR is the default locale; routes are always
  prefixed `/{ar,en}/...`; full RTL)
- **Background jobs:** BullMQ + Redis (`workers/index.ts` spawns one worker
  per queue: `reminders`, `whatsappOutbound`, `complianceDailyCheck`)
- **Calendar UI:** react-big-calendar (resource view, custom event renderer,
  RTL fixes in `components/calendar/calendar.css`)
- **PDF export:** @react-pdf/renderer (`lib/exports/patientFile.tsx`)
- **File storage:** AWS SDK v3 + presigned PUT URLs (MinIO locally, S3 in
  production; `lib/storage/`)
- **Analytics charts:** Recharts (`components/analytics/`)
- **Tests:** Vitest for unit + integration (912 passing); Playwright scaffolds
  for a11y + mobile (run after `pnpm playwright install`)

---

## Brand palette (locked)

Defined in `tailwind.config.ts` as the `brand.*` namespace. Don't introduce
new colors — extend semantically (e.g. `brand-textMuted` rather than
`gray-500`):

- `brand-navy` — primary text + headings
- `brand-cyan` — accent + interactive primary
- `brand-teal` — secondary accent
- `brand-bg` — application background
- `brand-surface` — card / dialog background
- `brand-border` — separators + outlines
- `brand-text` — body text
- `brand-textMuted` — secondary text

---

## Code organization

```
app/[locale]/                Next.js App Router; locale always prefixed
  (admin)/admin/             Admin UI — users, rooms, settings, audit, dashboard, leaves
  (staff)/                   Secretary + Doctor + Therapist UIs
  (patient)/patient/         Patient portal
  (auth)/                    Login + password change
  api/v1/                    Internal API routes (webhooks, exports, presigned URLs)

components/                  React components grouped by domain
  forms/AppForm.tsx          Form pattern (react-hook-form + Zod)
  data-table/DataTable.tsx   Table pattern (server-side pagination + filters)
  ui/                        shadcn primitives + ResponsiveModal
  appointments/              Modals + pickers driving the calendar
  calendar/                  Calendar view + side panel + cancel modal
  analytics/                 Recharts widgets
  leave/                     Leave request + admin approval
  exports/                   PDF export trigger button
  patients/                  Patient header, file tabs

lib/                         Business logic — no JSX here
  appointments/              Conflict engine, recurrence expansion, series ops
  auth/                      Auth.js config, password + OTP, RBAC guards
  rbac/                      permissions.ts (the matrix) + can.ts (the helper)
  admin/                     Admin services (users, rooms, audit, clinic-settings)
  clinical/                  Plans, session notes, day reports, weekly review
  patients/                  Patient profile services + queries
  intake/                    Intake assessment services
  appointments/              Single + bulk-series flows + recurrence
  notifications/             In-app notifications (typed templates)
  whatsapp/                  Provider abstraction (console / twilio / meta) + templates
  queue/                     BullMQ client + per-queue job modules
  storage/                   Presigned URL helpers
  exports/                   Patient-file PDF renderer + redaction
  analytics/                 Cached query layer (Redis TTL 5min)
  leave/                     Leave workflow + conflict scan
  audit/withAudit.ts         The audit decorator
  format/                    date / phone formatters
  i18n/                      Locale helpers
  env.ts                     Zod-validated environment

prisma/
  schema.prisma              Single source of truth for the data model
  migrations/                8 timestamped migrations
  seed.ts + seed/            Two-tier seed (reference + dev data)

workers/                     BullMQ worker entrypoints + per-queue handlers
messages/{en,ar}.json        i18n catalogs — kept in sync by `pnpm i18n:check`
docs/                        Per-feature documentation; see docs/README.md
tests/                       Playwright e2e scaffolds (a11y + mobile)
```

Unit tests live next to source: `lib/foo/__tests__/foo.test.ts`. End-to-end
Playwright specs live under `tests/e2e/`.

---

## Patterns to follow without exception

### Server actions

- Return `Result<T, LocalizedError>` from `lib/auth/result.ts` — never
  throw across the action boundary.
- The inner service function is wrapped with `withAudit(...)` so every
  state mutation writes one row to `AuditLog`.
- Permission check at the action boundary: `await requirePermission('foo.bar')`.
- Override permissions (e.g. `appointments.override_conflict`) are checked
  in addition to the base permission, gated by the input flag.

### Forms

- `react-hook-form` + Zod resolvers. The Zod schema is the single source of
  truth — UI labels read from next-intl, validation comes from the schema.
- See `components/forms/AppForm.tsx` and the patient registration form for
  the reference pattern.

### Tables

- `components/data-table/DataTable.tsx` is the reference. Server-side
  pagination + search + filter, with URL query params as the durable state.
- Filter state lives in `searchParams`, not React state — refresh-safe + linkable.

### Conflict engine

- **One file owns all conflict logic:** `lib/appointments/conflicts.ts →
checkConflicts()`. Every action that creates or moves an appointment
  routes through it. Never re-derive availability elsewhere.
- The conflict set is exhaustive, not first-match (a Friday 08:00 booking
  with an overlap returns BOTH `OUTSIDE_BUSINESS_HOURS` and
  `THERAPIST_OVERLAP`).

### Series edits

- Cancel, drag-reschedule, change-therapist on a series-bound appointment
  always pass an explicit `seriesMode: 'ONE' | 'FOLLOWING' | 'ALL'`. There
  is no implicit "if seriesId exists, apply everything" inference.
- `FOLLOWING` is boundary-inclusive: `startsAt >= target.startsAt`.
- Bulk paths run inside `db.$transaction`; any single conflict aborts the
  whole batch via `BulkAppointmentError` carrying the failing occurrences.

### WhatsApp

- **One provider abstraction:** `lib/whatsapp/providers/`. The factory in
  `lib/whatsapp/factory.ts` reads `env.WHATSAPP_PROVIDER` and returns one
  of `console | twilio | meta`. Callers never branch by provider name.
- All outbound goes through the `whatsappOutbound` queue so retries,
  audit, and rate limiting are uniform.
- Inbound webhooks live at `app/api/v1/whatsapp/webhook/{twilio,meta}/route.ts`
  with signature verification per provider.

### Notifications

- `lib/notifications/` is the generic in-app notification system. Add a
  `NotificationType` enum value + a row in `NOTIFICATION_TEMPLATES` keyed
  to i18n keys + a parameter shape. The renderer interpolates via
  next-intl's ICU placeholders.

### i18n

- **Zero hardcoded UI strings.** Every label goes through
  `useTranslations('namespace')`. CI gate: `pnpm i18n:check` enforces
  EN + AR key parity (currently 1087 keys).
- New keys go in the matching namespace in both `messages/en.json` and
  `messages/ar.json` in the same commit.

### Audit

- Every state-changing service function is wrapped at export with
  `withAudit({...}, async function inner(...) {...})`. The decorator writes
  one `AuditLog` row per successful call. Thrown exceptions never audit
  (we only record committed state).

### Permissions

- `lib/rbac/permissions.ts` is the catalog. Codes are dotted strings like
  `appointments.update`, `patients.read.assigned`, etc.
- `lib/rbac/can.ts` is the resolver — `can(user, action, resource?)` handles
  unscoped, owner-scoped, and assigned-scoped grants.
- New permissions require an update to `lib/rbac/__tests__/can.test.ts`.

### Time + dates

- All `DateTime` columns are UTC at the storage layer.
- Display is locale-aware via `lib/format/date.ts` (`formatDate`,
  `formatTime`, `formatDateTime`). Patient `hijriCalendarPref` flips the
  formatter to Hijri.
- Recurring expansion anchors on UTC for DST-safety
  (`lib/appointments/recurrence.ts`).

### Storage

- Direct browser-to-S3 uploads via presigned PUT URLs from
  `lib/storage/presign.ts`. Never proxy uploads through Next.js handlers.
- MinIO locally with `forcePathStyle: true`; production uses AWS S3.
- Public URLs read from `env.S3_PUBLIC_BASE_URL` (CDN in prod).

---

## Anti-patterns to refuse

Refuse politely and explain why, citing this file:

- `if (provider === 'twilio') { ... }` **outside** `lib/whatsapp/providers/` —
  the abstraction exists to keep callers provider-agnostic.
- Re-implementing conflict checks anywhere except `lib/appointments/conflicts.ts`.
- Direct `db.X.update(...)` from a client component or a route handler that
  isn't a server action — go through `lib/{domain}/actions.ts`.
- Hardcoded UI strings in any locale — break the i18n contract.
- New npm dependencies without justification. The stack is intentionally
  tight; "just install X" is not an acceptable rationale.
- Modifying the `brand.*` color tokens or introducing parallel design tokens.
- Bypassing `requirePermission(...)` in a server action.
- Logging PII (phone numbers, emails, full names, free-text patient notes)
  to console without going through a redaction helper.
- Skipping the `withAudit` wrapper on a state-changing service.
- Adding a `NotificationType` or `InboxItemType` enum value without the
  matching template in `NOTIFICATION_TEMPLATES` + i18n keys in both catalogs.

---

## Quality gates (all must pass before commit)

The pre-commit hook runs the staged-file subset; CI runs the full set:

```bash
pnpm typecheck         # strict TS, no emit
pnpm lint              # ESLint, zero warnings tolerated
pnpm format:check      # Prettier check
pnpm test              # Vitest run (currently 912 tests)
pnpm i18n:check        # EN + AR key parity
pnpm build             # Next.js production build
pnpm size-limit        # 200 kB gzipped first-load JS budget
```

When you finish a change, run typecheck + lint + the affected test file
locally before committing. If something breaks downstream, fix it in the
same commit — don't push a known-red CI run.

---

## Build history reference

The system was built across 12 sequential prompts. Each prompt's full spec
lives in `docs/prompts/` — the canonical record of design intent for that
slice of the system. When asked to modify a feature, **read the relevant
prompt first**; it explains what the user is actually buying.

Quick mapping:

| Prompt | Owns                                                         | Key files                                                          |
| ------ | ------------------------------------------------------------ | ------------------------------------------------------------------ |
| 1      | Foundation (Next.js, brand tokens, locale routing)           | `tailwind.config.ts`, `app/[locale]/layout.tsx`                    |
| 2      | Data model + dev seed                                        | `prisma/schema.prisma`, `prisma/seed/dev-data.ts`                  |
| 3      | i18n bundles + RTL fixes                                     | `messages/{en,ar}.json`, `i18n/`                                   |
| 4      | Auth + RBAC + audit                                          | `lib/auth/`, `lib/rbac/`, `lib/audit/`                             |
| 5      | Admin panel (users, rooms, intake questions)                 | `app/[locale]/(admin)/`, `lib/admin/`                              |
| 6      | Patient management + intake forms                            | `lib/patients/`, `lib/intake/`                                     |
| 7 + 7b | Calendar + conflict engine + series                          | `lib/appointments/`, `components/calendar/`                        |
| 8      | WhatsApp provider abstraction + webhooks                     | `lib/whatsapp/`, `app/api/v1/whatsapp/`                            |
| 9      | Clinical workflows (plans, notes, timeline)                  | `lib/clinical/`, `lib/notifications/`                              |
| 10     | Home program + compliance + reminders                        | `lib/clinical/home-program/`, `workers/homeReminder.ts`            |
| 11     | Leave, analytics, PDF export, settings, audit viewer, deploy | `lib/leave/`, `lib/analytics/`, `lib/exports/`, `lib/admin/audit/` |
| 12     | This documentation pass                                      | `CLAUDE.md`, `README.md`, `docs/README.md`                         |

---

## Where things live (quick reference)

| Question                                    | Answer                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Why is this slot unbookable?                | `lib/appointments/conflicts.ts`                                                                                           |
| How does the recurring builder fan out?     | `lib/appointments/recurrence.ts` + `services.ts`                                                                          |
| What permissions does role X have?          | `lib/rbac/permissions.ts` → `ROLE_PERMISSIONS`                                                                            |
| How is a patient's file structured?         | `components/patients/PatientFilePage.tsx`                                                                                 |
| Why didn't this WhatsApp message send?      | `lib/whatsapp/providers/` + `InboxItem.OUTBOUND_DELIVERY_FAILED`                                                          |
| How does the dashboard compute utilization? | `lib/analytics/queries.ts → getUtilization`                                                                               |
| Where do I add a clinic-wide setting?       | `prisma/schema.prisma` (ClinicSettings) + `lib/admin/clinic-settings/`                                                    |
| How does PDF export decide what to redact?  | `lib/exports/redaction.ts → resolveRedaction`                                                                             |
| Where is the audit decorator?               | `lib/audit/withAudit.ts`                                                                                                  |
| Where do bulk-series actions live?          | `lib/appointments/services.ts → cancelAppointmentSeries / rescheduleAppointmentSeries / changeAppointmentTherapistSeries` |

---

## How to verify a change end-to-end locally

```bash
pnpm infra:up                          # Postgres + Redis + MinIO
pnpm db:reset                          # apply migrations + seed dev data
pnpm dev                               # web app on :3000
pnpm workers:start                     # in a second terminal — BullMQ workers
```

Then exercise the change in both locales (`/en/...` and `/ar/...`) and as
each affected role using the dev-seed credentials below. Confirm the
audit log captured the action: `/en/admin/audit` filtered to the last
minute.

### Dev-seed credentials (Tier 2 seed — **dev only**)

| Role       | Email                  | Password        |
| ---------- | ---------------------- | --------------- |
| Admin      | `admin@theone.pt`      | `Admin@123`     |
| Doctor     | `dr.sara@theone.pt`    | `Doctor@123`    |
| Secretary  | `secretary@theone.pt`  | `Reception@123` |
| Therapists | `therapist*@theone.pt` | `Therapist@123` |
| Patients   | `*@example.com`        | `Patient@123`   |

These are **never** loaded in production (the seed checks
`NODE_ENV !== 'production'`). The first production Admin is created via
`pnpm bootstrap:admin` from `scripts/bootstrap-admin.ts`.

---

## Hard limits (do not relax)

- **Single-clinic system.** Multi-tenant is v2 and touches every query.
- **Web-only v1.** PWA install is v1.1; native mobile is v2.
- **No billing / payments.** v2.
- **No insurance integration.** v2.
- **WhatsApp is the primary patient channel.** Email is intentionally
  deferred (see `docs/backlog.md`); no Resend / SendGrid integration.
- **No PII in logs.** When in doubt, redact.
- **The conflict engine is the only authority on slot availability.**
- **The audit log is append-only.** No "fix the audit row" workflow exists,
  and none should.

---

## Confirmation gate (Prompt 0 §10)

When starting any non-trivial change:

1. Restate the user's request in your own words.
2. List any assumptions you're making.
3. List any clarifying questions that block correct work.
4. Wait for confirmation before writing code.

For tiny obvious changes (one-line bug fix, doc typo) skip the ceremony.
For anything that touches more than one file, or any new feature, or any
schema change, run the gate.

---

## When in doubt

- Read the relevant prompt spec in `docs/prompts/` first.
- Then read the feature's `docs/<area>/README.md` (calendar, home-program,
  whatsapp, etc.).
- Then read the closest existing implementation and follow its pattern.
- Then, only then, ask the user.

Most "should I add X?" questions have a "no, here's the established
pattern" answer encoded somewhere above. Find it before reinventing.
