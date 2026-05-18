# Contributing to Theone.pt

Theone.pt is a single-clinic deployment built by a small team; contributions
arrive through internal PRs rather than open-source pull requests. This file
captures the operating rules so each PR lands with the same shape.

## For human engineers

Start here: **[`docs/onboarding.md`](docs/onboarding.md)** walks you from a
fresh clone to your first PR.

## For AI assistants (Claude Code, etc.)

Start here: **[`CLAUDE.md`](CLAUDE.md)** encodes the conventions, patterns,
and anti-patterns established across 12 prompts of build work. Read it
before writing any code; it answers most "should I add X?" questions.

## Quality gates

All of these must pass locally before you push, and they all run in CI:

```bash
pnpm typecheck         # strict TS, no emit
pnpm lint              # ESLint, zero warnings tolerated
pnpm format:check      # Prettier
pnpm test              # Vitest run
pnpm i18n:check        # EN + AR key parity
pnpm build             # Next.js production build
pnpm size-limit        # 200 kB gzipped first-load JS per route
```

A PR cannot merge with any gate red.

## Code style

- Follow the established patterns. `CLAUDE.md` § "Patterns to follow without
  exception" lists them with file pointers.
- No new npm dependencies without explicit justification. The stack is
  intentionally tight.
- Domain logic lives in `lib/<domain>/`; UI components in
  `components/<domain>/`. No JSX in `lib/`, no business logic in
  `components/`.
- Server actions return `Result<T, LocalizedError>` and never throw across
  the boundary.

## Commits

Conventional Commits: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`,
`test:`. The commitlint hook enforces the format and a 100-character
subject limit.

Each commit must leave all quality gates green. If a chain of related
commits is needed, each intermediate commit must still compile and pass
tests — `git bisect` should always land on a usable state.

## Pull requests

- Reference the relevant prompt spec(s) in the description
  (e.g. "Prompt 9 §4.3 — addendum thread on session notes").
- Note any deviations from the established patterns and explain why.
- Include tests for new behavior (Vitest for `lib/` logic; Playwright e2e
  scaffolds for new UI flows). The 912-test baseline is the floor, not the
  ceiling.
- Update i18n bundles in the same commit as the UI change that needs them.
- Update the relevant `docs/<area>/README.md` if the change alters
  documented behavior.

## What not to touch without sign-off

- The locked tech stack (see `CLAUDE.md` § Tech stack).
- The brand color tokens in `tailwind.config.ts`.
- The conflict engine's public contract (`lib/appointments/conflicts.ts`).
- The WhatsApp provider interface (`lib/whatsapp/providers/`).
- The audit decorator (`lib/audit/withAudit.ts`).
- The RBAC catalog (`lib/rbac/permissions.ts`).

These are the load-bearing pieces; changes here ripple across the whole
system and need owner review before implementation.

## Reporting issues

For now, issues come via the internal team channel — there's no
public issue tracker. Operational incidents have their own playbook in
[`docs/ops/runbook.md`](docs/ops/runbook.md).
