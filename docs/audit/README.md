# Audit log

Owner: **Prompt 2** (table) + **Prompt 4** (decorator). Implementation in
[`lib/audit/withAudit.ts`](../../lib/audit/withAudit.ts) and the `AuditLog`
model in [`prisma/schema.prisma`](../../prisma/schema.prisma).

## The rule

> **Every state-changing service function must be wrapped with `withAudit`.**

CI cannot enforce this. The discipline is a code-review checklist:

- [ ] Does this PR add or modify a function that writes to the database?
- [ ] Is the function wrapped with `withAudit(...)` at its export?
- [ ] Does the audit `entityType` match the Prisma model name?
- [ ] Does `extractEntityId` always return a non-empty id?
- [ ] Does `extractAfter` redact secrets? (Never log `passwordHash`,
      `nationalId`, free-text clinical notes verbatim — capture a marker
      like `{ event: 'PASSWORD_CHANGED' }` instead.)

Audit reads are a separate concern. Use `AuditAction.READ_SENSITIVE` and
wrap the _query_ with `withAudit` when the read itself is a tracked event
(e.g. opening a patient's clinical history). Routine reads are not audited.

## The decorator

```ts
import { withAudit } from '@/lib/audit/withAudit';
import { AuditAction } from '@prisma/client';

type Args = [input: { id: string; patch: Partial<Patient> }];

export const updatePatient = withAudit<Args, { id: string }>(
  {
    entityType: 'PatientProfile',
    action: AuditAction.UPDATE,
    extractEntityId: (args, _result) => args[0].id,
    extractBefore: (args) => db.patientProfile.findUnique({ where: { id: args[0].id } }),
    extractAfter: (result) => result,
  },
  async function updatePatientInner({ id, patch }) {
    return db.patientProfile.update({ where: { id }, data: patch });
  },
);
```

### Behavioural guarantees

1. The wrapped function's signature and return value are **identical** to the
   inner — callers see no decorator.
2. Audit row writes only when the inner **resolves successfully**. A throw
   skips audit entirely; we record committed state, not attempts.
3. Audit-write failures **never break the user-visible operation**. A failed
   `db.auditLog.create` is logged to stderr (and to Sentry once Prompt 11
   lands) and swallowed.
4. The actor is resolved from `await auth()` by default; pass an
   `actorOverride` for system jobs (cron WhatsApp reminders, etc.).

### Use of `actorOverride`

System jobs without a user session must still produce attributable audit
rows. Convention: seed a `system` user (Prompt 5 will own that), then:

```ts
actorOverride: async () => 'system-user-id',
```

## The canonical example

[`lib/auth/services/changePassword.ts`](../../lib/auth/services/changePassword.ts)
is the reference. It demonstrates:

- The **service / action split** Next.js requires for files containing
  classes or non-async exports.
- The use of `AuditAction.UPDATE` with a synthetic
  `extractAfter: () => ({ event: 'PASSWORD_CHANGED' })` so the new hash never
  leaks into the audit row.
- Re-throwing typed errors (`ChangePasswordError`) so the action facade
  layer can convert them to `Result<T, E>` without the audit wrapper getting
  in the way.

Future state-changing services (intake submission, appointment creation,
treatment-plan update, leave approval, etc.) should follow the same
shape.
