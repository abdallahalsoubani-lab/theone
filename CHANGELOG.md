# Changelog

All notable changes to Theone.pt are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] — TBD

Initial production-ready release. The system was built across 12 sequential
prompts (`docs/prompts/`) spanning foundation, features, polish, and launch
readiness. 61 commits, feature-complete for a single-clinic v1 deployment.

### Added

**Foundation — Prompts 1-3**

- Next.js 15 App Router + React 19 + TypeScript strict mode + Tailwind CSS +
  shadcn/ui primitives with locked brand tokens (`brand-navy`, `brand-cyan`,
  `brand-teal`, etc.).
- PostgreSQL schema with **26 Prisma models, 28 enums, 8 timestamped
  migrations**. Singleton `ClinicSettings`, two-tier seed (reference + dev
  data).
- Bilingual EN + AR via next-intl with locale always prefixed in the route
  and full RTL support. `pnpm i18n:check` enforces EN+AR key parity in CI.
- Application shell — Header / Footer / Sidebar / MobileNav / LanguageToggle.
- Style-guide route as a visual smoke test of every brand token.
- Pinned tooling — pnpm 10, Node 20 LTS, Husky pre-commit, commitlint,
  ESLint zero-warnings, Prettier, dotenv-cli, Docker Compose for local
  Postgres + Redis + MinIO.

**Auth + RBAC — Prompt 4**

- Auth.js v5 beta with Credentials provider (email + password, bcrypt) and
  Phone-OTP provider (Redis-backed OTP, 6 digits, 5-minute TTL).
- Edge/Node config split so middleware stays edge-lite.
- RBAC catalog — ~70 permission codes organized as dotted strings; 5 roles
  (Admin / Doctor / Therapist / Secretary / Patient); `can(user, action,
resource?)` resolver with unscoped + owner-scoped + assignment-scoped
  variants; `requirePermission(...)` action guard.
- `withAudit` decorator that wraps every state-changing service function
  and writes one `AuditLog` row per call.
- Force-reset password flow + first-login mandatory change.

**Admin Panel — Prompt 5**

- Users module — list / create / edit / archive / restore / force-reset.
- Specialties module — list / create / edit / deactivate / delete.
- Rooms module + `rooms.*` permissions (read for all staff).
- Custom Intake Questions — CRUD with reorder, type + options support,
  edit-safety guards (don't break in-flight intakes).
- Foundation components — `AppForm` + `AppField` (react-hook-form + Zod),
  `DataTable` (server-side pagination + filters + URL state),
  `ConfirmDialog`, `Toaster`.

**Patient Management + Intake — Prompt 6**

- Patient registration with WhatsApp credentials provisioning.
- Role-scoped patient list views (Secretary / Doctor / Therapist).
- Patient file with tabs — Profile / Activity log; reset-password action.
- Adult + Pediatric intake forms with `CustomQuestionField` support.
- Patient self-edit portal page.

**Calendar + Conflict Engine — Prompts 7 + 7b**

- Single source of truth conflict engine
  (`lib/appointments/conflicts.ts`) with five conflict kinds —
  `THERAPIST_OVERLAP`, `PATIENT_OVERLAP`, `THERAPIST_ON_LEAVE`,
  `OUTSIDE_BUSINESS_HOURS`, `CLINIC_CLOSED_THIS_DAY`. Exhaustive
  conflict set (not first-match).
- Appointment status state machine (`SCHEDULED → CONFIRMED →
IN_PROGRESS → COMPLETED` plus `CANCELLED` and `NO_SHOW` terminal
  states) with permission-aware transitions.
- Server actions for create + reschedule + change-therapist + cancel
  - status transitions, each wrapped with `withAudit`.
- `react-big-calendar` Secretary view with resource columns, drag +
  drop reschedule, custom event renderer, brand CSS, RTL fixes.
- Create-appointment modal with live conflict preview.
- Appointment side panel with status actions.
- Drag-reschedule wired through the same conflict engine.
- **Cancel-with-category** (Prompt 7b §4.2) — required category picker
  with 9 categories, optional notes (≤ 500), WhatsApp notify gate.
- **Recurring series builder** (Prompt 7b §4.4) — weekly pattern, up to
  52 occurrences, per-occurrence resolution (Skip / Shift +1d / Shift
  +1w / Override) with conflict re-check on every shift.
  Transactional insert; any failure aborts the whole series.
- **Change-therapist modal** (Prompt 7b §4.6) — picker with batched
  availability dots (parallel `Promise.all` across candidates),
  re-checks at submit, dual `APPOINTMENT_THERAPIST_ASSIGNED /
_REMOVED` notifications.
- **Series-edit modes** (Prompt 7b §4.7) — `ONE` / `FOLLOWING` / `ALL`
  scope picker before cancel, drag-reschedule, change-therapist.
  Bulk paths transactional with all-or-nothing semantics.

**WhatsApp Abstraction — Prompt 8**

- Provider factory + interface; three implementations:
  - `console` — dev stub, logs structured payloads to stderr.
  - `twilio` — Sandbox + Production (no SDK; direct REST + HMAC verify).
  - `meta` — Cloud API (no SDK; direct Graph API + `x-hub-signature-256`).
- Outbound queue worker — single chokepoint for every outbound
  message; uniform retries + audit + rate limiting.
- Inbound webhook routes (`/api/v1/whatsapp/webhook/{twilio,meta}`)
  with signature verification.
- Inbound intent parser — EN + AR keywords for reschedule / cancel /
  confirm; falls through to "unknown" for triage.
- Secretary inbox surface (`InboxItem`) for delivery failures +
  inbound messages + (later) leave conflicts.
- Admin templates module + admin messages explorer; WhatsApp
  reachability column on `User` with deliverability tracking.

**Clinical Workflows — Prompt 9**

- Treatment plans — Doctor authors; Therapist can propose changes;
  Doctor approves or rejects. Versioned via `parentPlanId`. Plan
  status state machine (`DRAFT / ACTIVE / PROPOSED / PAUSED /
DISCONTINUED`).
- SOAP session notes — one primary note per appointment; **immutable
  after 24 hours** except via addendum chain (`parentNoteId`).
- Day reports (Therapist) + weekly review (Doctor).
- Doctor & Therapist dashboards with role-specific widgets.
- Patient timeline — chronological aggregation across appointments +
  notes + plan changes + reports; full-text search.
- In-app notifications — generic typed-template system with bell
  - unread count + mark-read action.
- Patient timeline tab on the patient file (clinical roles only).

**Home Program + Compliance — Prompt 10**

- Exercise library — CRUD with versioning (`replacedById`), media
  upload via S3 presigned PUT URLs.
- Home program builder — per-item schedule (`daysOfWeek` + scheduled
  time + duration + sets-reps + therapist note).
- Patient portal — exercise list with complete-today action.
- Compliance widget on patient file (7-day + 30-day adherence,
  streak, last completion).
- Recurring WhatsApp reminders — one BullMQ repeat job per active
  `HomeProgramItem`, cron derived from `daysOfWeek` +
  `scheduledTime - HOME_REMINDER_OFFSET_MINUTES` with `tz:
Asia/Amman`.
- Daily low-compliance scan worker — fires `LOW_COMPLIANCE`
  notifications to the responsible therapist at 18:00 local time
  for patients < 50% adherence over 7 days.

**Launch Readiness — Prompt 11**

- **Leave management** — request → approve / reject workflow,
  conflict scan against existing appointments emits `LEAVE_CONFLICT`
  inbox items, calendar renders approved leaves as background blocks
  on the therapist's column.
- **Analytics dashboards** — cached query layer (Redis 5-min TTL),
  Admin dashboard with KPI row + monthly trend + top diagnoses +
  referral sources + cancellation categories + utilization.
  Doctor compliance trend + Therapist schedule density.
  Patient dashboard with next-appointment card + 7-day completion strip.
- **Patient-file PDF export** (`@react-pdf/renderer`) with role-aware
  redaction — patient self-export omits clinical sections; clinical
  staff get full file; Admin adds audit summary. Audited as
  `READ_SENSITIVE` on every export.
- **Clinic Settings UI** — tabbed editor for the singleton
  `ClinicSettings` row (General / Hours / Appointments / Languages /
  Service types / Clinical privacy). The conflict engine reads
  `businessHours` so the JSON shape is locked.
- **Audit Log viewer** — `/admin/audit` with server-side pagination,
  date / actor / entity / action filters, streaming CSV export.
- **ResponsiveModal wrapper** — bottom sheet on mobile (< 768 px),
  centered on desktop. Wraps Cancel / CreateSeries / ChangeTherapist
  / CreateAppointment modals + the appointment side panel.
- **Login UI** — removed broken reset-password placeholder; added
  "Contact your clinic Admin" hint in EN + AR.
- **Bundle-size budget** — 200 kB gzipped first-load JS per route,
  enforced via `pnpm size-limit` in CI.
- **Bootstrap admin script** — one-shot `pnpm bootstrap:admin`
  guarded on `NODE_ENV === 'production'` + empty user table.
- **Deploy workflow** — `.github/workflows/deploy.yml` template for
  Path B (VPS + Docker Compose). Guard step short-circuits when
  secrets are absent.
- **Operations documentation** — runbook, disaster recovery,
  onboarding, backlog, deploy guides (Path B primary, Path A
  alternative), a11y procedures, perf budget, mobile QA checklist.

**Documentation Pass — Prompt 12**

- Top-level `CLAUDE.md` for AI assistants (conventions, patterns,
  anti-patterns, where things live).
- Top-level `README.md` rewrite reflecting the feature-complete
  v1.0 state.
- `docs/README.md` index of all documentation files.
- `docs/architecture/overview.md` system diagram + request lifecycle.
- `CONTRIBUTING.md` short pointer file.
- `.env.example` completeness check + missing-var fix
  (`HOME_REMINDER_OFFSET_MINUTES`, `S3_PUBLIC_BASE_URL`).
- This `CHANGELOG.md`.

### Metrics at launch

- **912 tests passing** across 36 test files
- **1,087 i18n keys** EN + AR in sync
- **8 Prisma migrations** (init through leave workflow)
- **61 commits** on the build branch
- **26 Prisma models, 28 enums**
- **~70 RBAC permission codes** × 5 roles
- **5 WhatsApp template families** × 2 languages
- **3 background queues** + 1 daily cron + per-exercise recurring jobs

### Intentional deferrals

Tracked with revisit triggers in [`docs/backlog.md`](docs/backlog.md):

- **Resend transactional email** — Admin issues temp passwords via
  `/admin/users` for v1; revisit when the Admin becomes a bottleneck.
- **Sentry error monitoring** — bug reports come from users directly
  in v1; revisit when the team grows past in-person reporting.
- **Web Vitals reporter** — deferred with Sentry.
- **PWA / installable mobile** — v1.1 small task.
- **Bulk patient import** — one-off script when needed, not a feature.
- **Billing & payments** — v2.
- **Multi-tenant support** — v2.
- **Native mobile apps** — v2.
- **Insurance integration** — v2.
- **Patient self-booking** — v1.1.
- **Antivirus scanning of uploads** — v1.1 hardening.
- **Server-side image thumbnails** — v1.1 polish.
- **Audit Log full JSON diff drawer** — currently raw before/after
  in collapsible `<details>`.
- **Clinic Settings service-types drag-reorder** — array editor in
  v1; visual reorder deferred.
- **Playwright a11y + mobile suite execution** — scaffolds + READMEs
  ship in `tests/e2e/{a11y,mobile}/`; run after `pnpm playwright
install`.

### Operational notes

- First production Admin is created via `pnpm bootstrap:admin`
  against a clean database (refuses with non-empty user table or
  `NODE_ENV !== 'production'`).
- Deploy workflow template (`.github/workflows/deploy.yml`) needs
  `DEPLOY_*` + `REGISTRY_*` + `SMOKE_URL` secrets populated in the
  repository's Actions settings; until then the workflow's guard
  step short-circuits.
- The Spec §17 open questions have **PROPOSED** dispositions in
  [`docs/spec-amendments/prompt-11-open-questions.md`](docs/spec-amendments/prompt-11-open-questions.md);
  owner sign-off pending.

[Unreleased]: https://example.com/theone-pt/compare/v1.0.0...HEAD
[1.0.0]: https://example.com/theone-pt/releases/tag/v1.0.0
