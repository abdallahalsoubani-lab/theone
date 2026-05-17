# PROMPT 1 — Project Foundation
| Field | Value |
|---|---|
| **Phase** | 0 — Foundation |
| **Depends on** | Prompt 0 (Master Context) acknowledged and approved |
| **Builds toward** | Prompt 2 — Database Schema |
| **Estimated effort** | 1–2 Claude Code sessions |
---
## 1. Objective
Stand up the Theone.pt repository with a clean, type-safe Next.js 15 project, the locked brand identity wired into Tailwind and CSS variables, local infrastructure running under Docker Compose, code-quality tooling enforced via pre-commit hooks and CI, and a `/style-guide` page that proves the visual identity works end-to-end.

By the end of this prompt, a new engineer should be able to clone the repo, run two commands, and see the application running locally with the brand identity correctly applied — and a CI pipeline that catches lint, type, and test errors on every push.

This prompt does **not** introduce any business features. It only produces the engineering platform on which subsequent prompts build.
---
## 2. In scope
1. Next.js 15 (App Router) initialized with TypeScript strict mode
2. Tailwind CSS configured with the locked brand colors (both as Tailwind tokens **and** CSS variables)
3. shadcn/ui installed and themed to the brand palette
4. Full folder skeleton matching spec §11.1
5. Docker Compose for local infrastructure: PostgreSQL 16, Redis 7, MinIO (S3-compatible)
6. Environment management: `.env.example`, `.env.local` (gitignored), runtime env validation with Zod
7. Code quality: ESLint, Prettier, Husky pre-commit, lint-staged, commitlint with Conventional Commits
8. GitHub Actions CI: lint, typecheck, format-check, build
9. SVG logo placeholder (light and dark variants) per Prompt 0 §4.3
10. `/style-guide` route demonstrating brand colors, typography, components, and the logo
11. README with full setup instructions; `/public/README.md` documenting the logo swap procedure
12. Initial seed of base shadcn/ui components: `button`, `card`, `input`, `label`, `separator`, `badge`, `dialog`
---
## 3. Out of scope (deferred)
Do not implement any of the following in this prompt:
- **Prisma schema and models** — Prompt 2
- **next-intl integration** — Prompt 3
- **Authentication (Auth.js, login pages, RBAC middleware)** — Prompt 4
- **Any business features** (admin panel, patients, appointments, etc.) — Prompts 5+
- **WhatsApp provider implementations** — Prompt 8
- **Production deployment configuration** — final phase

If a task requires touching any of the above, stop and ask before proceeding.
---
> The full Prompt 1 specification continues with §4 Detailed tasks, §5 Acceptance criteria, §6 Verification commands, §7 Deliverables, §8 Notes for the implementing engineer, and §9 Hand-off to Prompt 2 — see the conversation history with the project owner for the authoritative copy.
