# `lib/db`

Public surface for application database access. Implemented in **Prompt 2**.

Import what you need from the package barrel — never from `@prisma/client` directly:

```ts
import { db, withTransaction, toLocalizedError, type User, type Appointment } from '@/lib/db';
```

Files:

| File             | Purpose                                                                           |
| ---------------- | --------------------------------------------------------------------------------- |
| `client.ts`      | Singleton Prisma client (with hot-reload protection in dev)                       |
| `transaction.ts` | `withTransaction(...)` wrapper with a bounded timeout                             |
| `errors.ts`      | Maps Prisma error codes to the localized `{ code, message_en, message_ar }` shape |
| `errors.test.ts` | Vitest coverage for the error mapper (P2002, P2025, P2003, P2024, fallback)       |
| `index.ts`       | Curated re-exports of the model types and enums the app actually uses             |

Behaviour notes:

- `nationalId` on `PatientProfile` is plaintext today and marked as encryption-target;
  the `pgcrypto` migration is owned by **Prompt 11** (hardening).
- Soft-delete is only implemented on `User`. Partial unique indexes in the init
  migration's raw SQL extension scope `phone` and `email` uniqueness to non-deleted rows.
- One `ACTIVE` plan per patient is enforced by the
  `treatment_plans_active_per_patient` partial unique index (also in the init
  migration's SQL extension). Inserting a second `ACTIVE` plan returns `P2002`.

See [`docs/db/schema.md`](../../docs/db/schema.md) for the ERD and decisions log.
