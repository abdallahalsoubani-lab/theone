# Theone.pt

Bilingual (English + Arabic, RTL) physiotherapy clinic management web application for
**The One for Physiotherapy** (المركز الأول للعلاج الطبيعي), Amman, Jordan.

> **Current phase: 0 — Foundation.** The repo runs end-to-end as a Next.js 15 + Tailwind
> application with the locked brand identity and a `/style-guide` route. No business
> features exist yet — those land in Prompts 2 onwards (see `docs/prompts/`).

---

## Prerequisites

- **Node.js 20 LTS** (pinned in `.nvmrc`; CI matches)
- **pnpm 10** (pinned in `package.json` under `packageManager`)
- **Docker Desktop** (for Postgres + Redis + MinIO locally)

---

## Quickstart

```bash
git clone <repo-url> theone-pt
cd theone-pt
cp .env.example .env.local
pnpm install && pnpm infra:up
pnpm db:reset      # apply schema + seed reference and dev data
pnpm dev
```

Visit:

- <http://localhost:3000/en> — landing page (English)
- <http://localhost:3000/ar> — landing page (Arabic, RTL layout)
- <http://localhost:3000/en/style-guide> — visual smoke test for the design system
- <http://localhost:9001> — MinIO console (login: `minio_admin` / `minio_admin_change_me`)

---

## Available scripts

| Command                  | Purpose                                                                    |
| ------------------------ | -------------------------------------------------------------------------- |
| `pnpm dev`               | Start the Next.js dev server on port 3000                                  |
| `pnpm build`             | Production build                                                           |
| `pnpm start`             | Run the production build                                                   |
| `pnpm typecheck`         | Strict TypeScript check (no emit)                                          |
| `pnpm lint`              | ESLint — zero warnings tolerated                                           |
| `pnpm lint:fix`          | ESLint with autofix                                                        |
| `pnpm format`            | Prettier — write changes                                                   |
| `pnpm format:check`      | Prettier — fail on drift (used in CI)                                      |
| `pnpm test`              | Vitest one-shot                                                            |
| `pnpm test:watch`        | Vitest in watch mode                                                       |
| `pnpm infra:up`          | Start docker-compose services (postgres, redis, minio) + init MinIO bucket |
| `pnpm infra:down`        | Stop docker-compose services (keeps volumes)                               |
| `pnpm infra:reset`       | Wipe volumes and restart fresh                                             |
| `pnpm infra:logs`        | Tail logs from all services                                                |
| `pnpm db:generate`       | Regenerate the Prisma client (after editing `schema.prisma`)               |
| `pnpm db:migrate`        | Create a new migration and apply it to the dev database                    |
| `pnpm db:migrate:deploy` | Apply pending migrations (used in production and CI)                       |
| `pnpm db:reset`          | Drop + recreate the dev database, replay all migrations, run the seed      |
| `pnpm db:seed`           | Run the seed against the current database without resetting                |
| `pnpm db:studio`         | Open Prisma Studio for visual table inspection                             |

---

## Folder structure

```
app/
  [locale]/              # 'en' | 'ar' — root layout sets <html lang dir>
    (auth)/              # Login, OTP, reset — owned by Prompt 4
    (patient)/           # Patient portal — owned by Prompts 6, 10
    (staff)/             # Secretary, therapist, doctor — owned by Prompts 7, 9
    (admin)/             # Admin panel — owned by Prompt 5
    style-guide/         # Visual smoke test for the design system
    page.tsx             # Landing
    layout.tsx           # Root layout (html + body + fonts)
  api/v1/                # REST endpoints — added by the prompt that owns each module
components/
  ui/                    # shadcn primitives (button, card, input, label, etc.)
  brand/                 # Logo and brand-specific components
  calendar/              # Owned by Prompt 7
  patient-file/          # Owned by Prompt 6
  whatsapp/              # Owned by Prompt 8
lib/
  env.ts                 # Runtime env validation (Zod)
  utils.ts               # cn() helper
  db/                    # Prisma client — owned by Prompt 2
  auth/                  # Auth.js v5 — owned by Prompt 4
  rbac/                  # Permission helpers + audit wrapper — owned by Prompt 4
  whatsapp/              # Provider abstraction — owned by Prompt 8
  queue/                 # BullMQ — owned by Prompt 8
messages/                # i18n catalogs — owned by Prompt 3
public/                  # logo.svg, logo-dark.svg, logo-wordmark.svg
scripts/                 # init-minio.sh and other ops scripts
docs/                    # Spec, master context, sequential build prompts
```

Most leaf directories ship with a one-line `README.md` pointing to the prompt that
owns them. As prompts land they replace placeholders with real implementations.

---

## Brand identity

Eleven brand tokens are wired into Tailwind (`bg-brand-navy`, `text-brand-cyan`, …) and
into `globals.css` as CSS variables (`var(--brand-navy)`) so they work in inline styles,
SVGs, and dynamically generated content alike. The complete palette and usage guide
lives in [docs/Prompt-0-Master-Context.md](docs/Prompt-0-Master-Context.md) §4.1.

The logo files in `/public` are **placeholders**. See [public/README.md](public/README.md)
for the swap procedure when the production logo is supplied.

---

## Dev credentials (seed data — never use in production)

`pnpm db:reset` creates the following accounts. Passwords are hashed with bcrypt and
land in the database; they exist purely to unblock UI development.

| Role               | Email                                                  | Password                                         |
| ------------------ | ------------------------------------------------------ | ------------------------------------------------ |
| Admin              | `admin@theone.pt`                                      | `Admin@123`                                      |
| Doctor             | `dr.sara@theone.pt`                                    | `Doctor@123`                                     |
| Therapist          | `ahmad@theone.pt`, `layan@theone.pt`, `omar@theone.pt` | `Therapist@123`                                  |
| Secretary          | `reception@theone.pt`                                  | `Reception@123`                                  |
| Patient (8 seeded) | phone-only or email                                    | `Patient@123` (with `mustChangePassword = true`) |

> Real authentication flow lands in **Prompt 4**. Until then these are seed-only.

## Reference documents

- [`docs/Theone-pt-Technical-Spec.md`](docs/Theone-pt-Technical-Spec.md) — full functional
  and technical specification (source of truth for behavior)
- [`docs/Prompt-0-Master-Context.md`](docs/Prompt-0-Master-Context.md) — project briefing,
  coding standards, working protocol
- [`docs/db/schema.md`](docs/db/schema.md) — entity-relationship diagram and design
  decisions for the data model
- [`docs/prompts/`](docs/prompts/) — sequential build prompts (Prompt 1 onward)

---

## Contributing

- **Branch naming.** `<type>/<short-description>`, e.g. `feat/secretary-calendar`,
  `fix/audit-log-race`. The current foundation branch is `claude/review-project-briefing-tnVPw`.
- **Commit messages.** Conventional Commits, enforced by commitlint:
  `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `perf:`, `style:`, `build:`, `ci:`, `revert:`.
- **Pull requests.** One PR per build prompt. The PR template
  (`.github/PULL_REQUEST_TEMPLATE.md`) prompts for the three required sections:
  **What was built**, **What was deferred and why**, **What to test manually**.
- **Pre-commit hooks.** Husky runs `lint-staged` (ESLint --fix + Prettier --write) on
  staged files. The `commit-msg` hook runs commitlint. Do not bypass with `--no-verify`
  unless the project owner has approved the workaround.

---

## License

To be confirmed by the project owner before public release.
