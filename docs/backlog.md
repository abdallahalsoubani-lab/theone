# Post-launch backlog

Per Prompt 11 §4.11.4. Explicit deferrals from the v1 build. Each
item carries the reason it was deferred and the signal that should
trigger it being picked up.

## Operational gaps deferred from Prompt 11

### Resend transactional email

- **Trigger to revisit**: when the Admin becomes a bottleneck for
  password resets, OR when the team grows past in-person reset
  requests, OR when a self-service "Forgot password" link is asked
  for by users.
- **Current workaround**: Admin issues temp passwords via
  `/admin/users`; the temp shows once on screen and is communicated
  via WhatsApp or in person.

### Sentry error monitoring (with PII redaction)

- **Trigger to revisit**: when bug reports from users get noisy or
  delayed; when there are too many engineers to all see the same
  console; when an SLA conversation requires error-rate metrics.
- **Current workaround**: users report directly; the Admin sees the
  team daily. `lib/logger.ts` is the lightweight PII-redaction
  stand-in.

### Web Vitals reporter

- **Trigger to revisit**: when a frontend performance complaint
  surfaces, OR when shipped with Sentry above.
- **Current workaround**: spot-check Chrome Lighthouse manually
  during QA.

## Prompt 11 polish deferrals

### Full ResponsiveModal a11y / mobile Playwright suites

- **Trigger to revisit**: before the first paying customer; whenever
  the design system materially changes.
- **Current state**: scaffolds + READMEs ship in
  `tests/e2e/{a11y,mobile}/`. Run after `pnpm playwright install`.

### Audit Log viewer — full JSON diff drawer

- **Trigger to revisit**: when the Admin actually starts using the
  audit log for forensics; when a complaint comes in that the raw
  JSON is hard to read.
- **Current state**: the audit page renders before / after as
  collapsible `<details>` blocks with the raw JSON. Replace with
  `jsondiffpatch` side-by-side highlighting.

### Clinic Settings — service-types drag-and-drop reorder

- **Trigger to revisit**: when the clinic uses 5+ service types and
  the sort order matters operationally.
- **Current state**: services are added/removed/edited but not
  reorderable; the `sortOrder` column on the JSON is honored on
  read but not mutable from the UI.

### Admin Audit — entity-link rendering

- **Trigger to revisit**: when the Admin starts the same workflow
  three times in a row (audit row → manually navigate to entity).
- **Current state**: the entity id is shown as plain text; the
  Admin copy-pastes into the URL bar.

## Spec §17 items closed as v1.1 / v2

- **PWA / installable mobile** — v1.1 small task; the existing
  responsive layout is already mobile-friendly.
- **Bulk patient import** — one-off script if the clinic has
  existing records to migrate. Not a feature.
- **Doctor consultation model** (multiple doctors per patient) —
  v2; the schema's single responsibleDoctor is sufficient for v1.
- **Patient self-booking** — v1.1; the foundation supports adding
  it without a redesign.
- **Billing & payments** — v2; large effort, separate vendor
  selection required.
- **Antivirus scanning of uploads** — v1.1 hardening (ClamAV
  integration).
- **Server-side image thumbnails** — v1.1 polish (sharp +
  S3-event trigger).
- **Adaptive video streaming** — out of scope.
- **CSAT / NPS surveys to patients post-visit** — v1.1; uses the
  WhatsApp infra already in place.
- **Multi-tenant / multi-clinic** — v2; major effort touching
  every query in the codebase.
- **Insurance integration** — deferred; vendor selection required.
- **Internal team chat** — out of scope; WhatsApp covers it.
- **Patient telehealth** — out of scope.
- **AI-assisted note drafting** — out of scope.
