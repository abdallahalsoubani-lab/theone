# PROJECT BRIEFING — Theone.pt
> **Engineering onboarding document. Read fully before producing any code.**
>
> This document is your project context. Every subsequent prompt assumes you have read and internalized this briefing and the referenced technical specification. Do not start writing code until you have confirmed understanding at the bottom of this document and received approval.
---
## 1. The product
You are joining the engineering effort to build **Theone.pt**, a bilingual (English + Arabic, RTL) responsive web application that manages day-to-day operations of **The One for Physiotherapy** (المركز الأول للعلاج الطبيعي), a physiotherapy clinic in Amman, Jordan, operating since 2021.
The application serves five distinct user roles inside one clinic — patients, secretaries, doctors, therapists, and admins — and integrates with the WhatsApp Cloud API for appointment confirmations, automatic reminders, and home-exercise prompts.
This is **not** a generic multi-tenant SaaS. It is a single-clinic operational tool, designed around the specific clinical workflow of a small-to-medium physiotherapy practice. Optimize accordingly: clarity over flexibility, opinionated defaults over configuration sprawl, well-modeled clinical concepts over abstract entities.
---
## 2. User roles
Full role definitions and the permissions matrix live in **§4 of the technical specification**. Brief summary:
| Role | Arabic | Primary responsibility |
|---|---|---|
| **Patient** | المراجع | Views appointments, follows the home exercise program, receives WhatsApp reminders |
| **Secretary** | السكرتيرة | Operational hub: books and reschedules appointments, fills patient intake forms, manages the daily calendar |
| **Doctor** | الدكتورة | Writes treatment plans, reviews session reports, sets clinical direction |
| **Therapist** | المعالج الطبيعي | Executes treatment plans, writes SOAP session notes, builds home-exercise programs with videos |
| **Admin** | المسؤول | Manages staff accounts, specialties, custom intake questions, leave, audit log, business settings |
---
## 3. Technology stack — locked
Do not introduce alternative frameworks, ORMs, or libraries without explicit approval from the project owner. Justify any new dependency in your PR description.
| Layer | Choice |
|---|---|
| Framework | **Next.js 15** (App Router) with **TypeScript strict mode** |
| Styling | **Tailwind CSS** + **shadcn/ui** |
| Database | **PostgreSQL 16** |
| ORM | **Prisma** |
| Authentication | **Auth.js v5** (NextAuth) |
| Internationalization | **next-intl** |
| Background jobs | **BullMQ** + **Redis** |
| WhatsApp (development) | **Twilio WhatsApp Sandbox** |
| WhatsApp (production) | **Meta WhatsApp Cloud API** (direct, no middleman) |
| File storage | **S3-compatible** (AWS S3 in production, MinIO in local Docker) |
| Calendar | **FullCalendar.io** with resource view (or **react-big-calendar** as free fallback — confirm before deciding) |
| Validation | **Zod** |
| Server state | **TanStack Query** |
| UI state | **Zustand** |
| Testing | **Vitest** + **Playwright** (E2E for critical flows only) |
| Error tracking | **Sentry** |
| CI/CD | **GitHub Actions** |
| Hosting (preferred) | **Vercel** + **Neon** (Postgres) + **Upstash** (Redis) |
| Hosting (alternative) | Single VPS with Docker Compose |
---
## 4. Visual identity
### 4.1 Brand color palette — locked
Wire these into **`tailwind.config.ts`** as named colors (so `bg-brand-navy` works) **and** declare them as CSS variables in `globals.css` (so `var(--brand-navy)` works in inline styles, SVGs, and dynamically generated content).
| Token | Hex | Usage |
|---|---|---|
| `brand.navy` | `#0B1E47` | Primary actions, headers, hero backgrounds, primary text |
| `brand.navyDeep` | `#091638` | Hover state on navy buttons |
| `brand.blue` | `#1B4982` | Secondary surfaces, gradient start |
| `brand.teal` | `#1E5F58` | Success states, highlight cards |
| `brand.cyan` | `#3DC0D9` | Icons, gradient end, links, accents |
| `brand.cyanLight` | `#7DDBE9` | Hover state on cyan |
| `brand.bg` | `#F2F4F8` | Page background |
| `brand.surface` | `#FFFFFF` | Cards, modals, elevated surfaces |
| `brand.text` | `#0B1E47` | Body text on light surfaces |
| `brand.textMuted` | `#5A6580` | Secondary text, captions |
| `brand.border` | `#D8DEE8` | Card borders, dividers |
**Primary CTA gradient:** `linear-gradient(90deg, #1B4982 0%, #3DC0D9 100%)`
### 4.2 Typography
- **Latin script:** Inter (variable, from Google Fonts)
- **Arabic script:** IBM Plex Sans Arabic (from Google Fonts)
- **Two weights only:** 400 (regular), 500 (medium). Never 600 or 700 — they read heavy.
- **Body:** 16px, line-height 1.6
- **Sentence case** everywhere — never Title Case, never ALL CAPS
- Load fonts via `next/font` with `display: swap`
### 4.3 Logo placeholder
The clinic logo will be supplied by the project owner later. For now:
- Create **`/public/logo.svg`** (for light backgrounds) and **`/public/logo-dark.svg`** (for dark headers)
- Design a simple, clean placeholder using brand colors — a geometric mark such as a navy circle/badge with white "T1" or a stylized motion arc representing movement and recovery
- Must be **SVG** (scales infinitely)
- Document the swap procedure in the README ("Replace the two SVG files in `/public` with the production logo; recommended dimensions and structure detailed in `/public/README.md`")
### 4.4 UI philosophy
- **Calm, clinical, trustworthy.** The system handles patient health data — every visual decision should reinforce credibility.
- **Generous whitespace.** No cramped layouts. Information hierarchy beats density.
- **Flat surfaces.** Subtle shadows only on elevated cards (dropdowns, modals, popovers). No glow, no neon, no mesh gradients.
- **RTL is first-class.** Arabic users get a mirrored layout, not a translated LTR layout. Test every component in both directions before declaring it done.
- **Mobile-first** for patient-facing views; **desktop-first** for staff dashboards (the calendar especially).
---
## 5. Coding standards — non-negotiable
1. **TypeScript strict mode.** No `any`. Prefer `unknown` plus narrowing.
2. **No hardcoded user-facing strings.** Every label, button, error, and toast goes through `next-intl`. CI must fail the build if any key exists in `messages/en.json` but not in `messages/ar.json` (and vice versa).
3. **Logical CSS properties.** Use `ms-*`, `me-*`, `start-*`, `end-*`, `ps-*`, `pe-*`. Never `ml-*` or `mr-*` for layout. RTL must work without per-component overrides.
4. **Mutations: server actions first.** REST endpoints under `/api/v1/...` exist only for external clients (mobile, third-party integrations) and webhooks. Internal forms use server actions.
5. **Prisma only.** No raw SQL except in reviewed and tested migrations.
6. **Zod schemas** for every server action input and every API request body. Type inference flows from Zod to the handler.
7. **Localized errors.** Every thrown error returns the shape: `{ code: string; message_en: string; message_ar: string; details?: Record<string, unknown> }`.
8. **RBAC at every entry point.** Every server action, API route, and protected page calls the shared helper `can(user, action, resource)` before any work. No exceptions, including admin endpoints.
9. **Audit log.** Every state-changing service function writes one entry to the `audit_log` table. Implement as a wrapper or decorator (e.g., `withAudit(...)`) so it is hard to forget.
10. **No client-side mutations** that bypass a server action or API route.
11. **Component size cap.** Components ≤ 200 lines. Beyond that, split into subcomponents or extract hooks.
12. **Minimum tests per server action:** one happy-path test + one RBAC-denial test. Use Vitest.
13. **Accessibility (WCAG 2.1 AA target).** Keyboard navigation on the calendar; visible focus rings; `aria-label` on icon-only buttons; color is never the sole signal.
14. **Performance budgets.** Calendar view renders 500 appointments in < 500 ms. P95 page load < 2.5 s on 3G.
---
## 6. WhatsApp strategy — provider abstraction
Two environments share one interface. Switching providers is configuration only.
### 6.1 Interface contract
Define in `lib/whatsapp/provider.ts`:
```ts
export interface WhatsAppProvider {
  sendTemplate(params: SendTemplateParams): Promise<SendResult>;
  sendText(params: SendTextParams): Promise<SendResult>;
  verifyWebhook(payload: unknown, signature: string): boolean;
  parseInbound(payload: unknown): InboundMessage[];
}
```
### 6.2 Implementations
- `TwilioWhatsAppProvider` — wraps Twilio's `messages.create` API and webhook signature scheme. Used in development and CI.
- `MetaWhatsAppProvider` — wraps Meta Graph API v20+ for sending and Meta's signature scheme for webhooks. Used in production.
Selected at runtime by env var: `WHATSAPP_PROVIDER=twilio|meta`. The rest of the application code imports the resolved provider from `lib/whatsapp/index.ts` and is unaware of which one is active.
### 6.3 Templates
- Adult and child intake do not use WhatsApp templates.
- Required templates (defined in spec §10.2): `appointment_confirmation`, `appointment_reminder_30min`, `appointment_rescheduled`, `appointment_cancelled`, `home_exercise_reminder`, `otp_login`, `patient_account_credentials`.
- Each template exists in both English and Arabic versions. Patient language preference (`user.language_pref`) selects which version is sent.
---
## 7. Internationalization and RTL
- Locale segment: `/[locale]/...` where `locale` is `en` or `ar`.
- Root layout sets `<html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>`.
- All copy lives in `messages/en.json` and `messages/ar.json`. CI fails the build if any key is missing in either file.
- Format numbers and dates via `Intl.NumberFormat` and `Intl.DateTimeFormat` with the active locale.
- Phone numbers always render LTR using Unicode LRM markers, even inside Arabic text.
- Dates: Gregorian by default. Users can toggle a Hijri display preference in their profile settings (the underlying stored value remains an ISO timestamp).
- Iconography that implies direction (chevrons, arrows): apply `rtl:rotate-180` where appropriate.
---
## 8. Working protocol
### 8.1 Before each work session
1. Read `docs/Theone-pt-Technical-Spec.md` (the full functional and technical specification). Every prompt references it by section number — do not invent behavior that is not in the spec.
2. Re-read this briefing.
3. Review the repository state: `git log --oneline -20`, the current Prisma schema, and any modules already implemented.
### 8.2 When in doubt
- **Ask** the project owner before deviating from the spec or this briefing.
- **Surface trade-offs** with a clear recommendation when there is a real choice.
- **Stop** if you find yourself about to write more than ~500 lines in one go — split into smaller, reviewable commits.
### 8.3 Definition of done (per prompt)
A prompt is complete when **all** of the following hold:
- Every acceptance criterion in the prompt passes
- Database migrations run cleanly on a fresh database (`npm run db:reset && npm run db:migrate`)
- All tests pass (`npm test`)
- TypeScript compiles with zero errors (`npm run typecheck`)
- Linting passes (`npm run lint`)
- `messages/en.json` and `messages/ar.json` are in sync
- README is updated if new commands, env vars, modules, or migrations were introduced
- Screenshots of any new UI are attached to the commit message or PR description
### 8.4 Pull request style
- One PR per prompt
- Commit messages follow conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
- PR description sections: **What was built**, **What was deferred and why**, **What the project owner should manually test**
---
## 9. Reference materials
| File | Purpose |
|---|---|
| `docs/Theone-pt-Technical-Spec.md` | Full functional and technical specification — **source of truth for behavior** |
| `docs/Prompt-0-Master-Context.md` | **This file** — paste at the start of every work session |
| `docs/prompts/Prompt-{1..11}-*.md` | Sequential build prompts (will be provided one at a time) |
---
## 10. Before you proceed — confirmation gate
**Do not write any code yet.** Reply to this briefing with the following four items in order:
1. **Restatement.** A 3–4 sentence description of Theone.pt in your own words, including the five user roles and the central role of WhatsApp.
2. **Top failure modes.** The four most likely *technical* failure modes for this project, ranked by severity. (Not commercial risks — engineering risks: e.g., calendar drag-and-drop on RTL mobile, template approval delays, audit log performance, etc.)
3. **Clarifying questions.** Any questions you have based on this briefing or the technical specification that, if left unanswered, would lead you to make assumptions during the build.
4. **Acknowledgment.** A one-line confirmation that you will follow the working protocol in §8, including the "ask before deviating" rule.
Only after the project owner reviews and approves your response will you receive **Prompt 1: Project Foundation**.
---
**Project owner:** _to be filled_
**Repository:** _to be created_
**Briefing version:** 1.0
**Briefing date:** May 2026
