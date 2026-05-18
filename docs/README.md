# Documentation index

All engineering documentation for Theone.pt lives in this directory. Each
subdirectory covers a feature area or operational concern. The top-level
[`CLAUDE.md`](../CLAUDE.md) and [`README.md`](../README.md) are the entry
points; everything below is reference.

## Operations

- [Runbook](ops/runbook.md) — daily / weekly / monthly / incident procedures
- [Disaster Recovery](ops/disaster-recovery.md) — backup, restore, RPO/RTO targets, total-loss procedure
- [Onboarding](onboarding.md) — new-engineer walkthrough, clone → first PR
- [Backlog](backlog.md) — explicit deferrals with revisit triggers

## Architecture

- [Overview](architecture/overview.md) — system layers + request lifecycle + key abstractions
- [Database schema notes](db/schema.md) — ER diagram + design rationale

## Deployment

- [VPS deployment (Path B)](deploy/vps.md) — primary deployment guide (Hetzner / DO + Docker Compose)
- [Managed deployment (Path A)](deploy/managed.md) — alternative via Vercel + Neon + Upstash (kept for reference)

## Features

- [Calendar workflow](calendar/README.md) — appointment scheduling, conflict engine, recurring series, series-edit modes
- [Home program](home-program/README.md) — exercise library, scheduled reminders, compliance scan
- [Storage](storage/README.md) — MinIO / S3 presigned-URL upload flow
- [Audit](audit/README.md) — `withAudit` decorator + AuditLog schema
- [Auth](auth/README.md) — Auth.js v5 config, OTP flow, RBAC
- [i18n](i18n/README.md) — locale routing, RTL, message-key conventions

## WhatsApp

- [Twilio setup](whatsapp/setup-twilio.md) — sandbox (dev/CI) + production application
- [Meta setup](whatsapp/setup-meta.md) — Cloud API + business verification
- [Templates](whatsapp/templates.md) — the seeded templates with parameter shapes

## Quality

- [Accessibility — keyboard](a11y/keyboard.md) — manual keyboard-navigation procedure
- [Accessibility — touch targets](a11y/touch-targets.md) — mobile interaction sizing + exception registry
- [Performance](perf/README.md) — bundle budget rationale + common offenders
- [Mobile QA](qa/mobile-devices.md) — device matrix for pre-release testing

## Reference

- [Technical Specification](Theone-pt-Technical-Spec.md) — the original 50 KB functional + technical design doc
- [Prompt 0 — Master Context](Prompt-0-Master-Context.md) — discipline list, working protocol, brand palette
- [Prompts](prompts/) — sequential build prompt specifications

## Spec amendments

- [Prompt 11 — open questions closure](spec-amendments/prompt-11-open-questions.md) — proposed dispositions for Spec §17, awaiting owner sign-off

---

## Documents not yet written

These are referenced from elsewhere but don't exist in the repo yet. Future
work fills the gaps:

- ⚠️ **`docs/clinical/README.md`** — high-level clinical workflows
  (treatment plans, session notes, day reports, timeline). Currently the
  prompt specs in `docs/prompts/` cover the design intent.
- ⚠️ **`docs/prompts/Prompt-2-*.md` through `Prompt-11-*.md`** — only
  Prompt 1's spec made it into `docs/prompts/`. The other 11 prompts
  exist as the project owner's working specifications but aren't checked
  into the repo. Owner to backfill if desired.
- ⚠️ **`docs/a11y/audit-log.md`** — per-release a11y audit findings.
  Created on each release run.

If you write any of these, remove the warning from this index in the same
commit.
