# Authentication & authorization

Owner: **Prompt 4**. Implementation spans `auth.ts`, `auth.edge.ts`,
`lib/auth/`, `lib/rbac/`, `lib/audit/`, `middleware.ts`, and
`app/[locale]/(auth)/`.

## Stack

| Concern          | Choice                                            | Notes                                                                                            |
| ---------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Library          | **Auth.js v5 beta** (`next-auth@5.0.0-beta.31`)   | API still in flux — see "Known caveats" below                                                    |
| Session strategy | JWT                                               | 7-day rolling expiry, 24h sliding refresh                                                        |
| Cookie           | HTTP-only, `SameSite=Lax`, `Secure` in production | Set by Auth.js                                                                                   |
| Adapter          | `@auth/prisma-adapter`                            | Only used for the eventual database-session option; JWT strategy means most operations bypass it |
| Password hashing | `bcryptjs` (cost 12)                              | Same hash format as the seed                                                                     |

## Configuration split (edge vs node)

Auth.js v5 middleware runs in **Edge runtime** by default. The full config
imports the Prisma adapter, `bcryptjs`, and Redis through the providers — none
of which work in the Edge sandbox. The project therefore exposes two configs:

| File                                       | Used by                                                  | Imports                                    |
| ------------------------------------------ | -------------------------------------------------------- | ------------------------------------------ |
| `lib/auth/edge-config.ts` + `auth.edge.ts` | `middleware.ts`                                          | Edge-safe — only the jwt/session callbacks |
| `lib/auth/config.ts` + `auth.ts`           | `app/api/auth/[...nextauth]/route.ts` and server actions | Full — providers, adapter, bcrypt, Redis   |

**Keep the jwt and session callbacks in sync** between the two files. They
read the same cookie; divergence breaks routing.

## Providers

Two `Credentials` providers — both swallow specific failure reasons and
return `null` on any miss so the client never sees "user not found" vs
"wrong password". Lockout state on the User row is surfaced by the
**server action**, not the provider:

| Provider id   | Inputs                                      | User scope                                  | Failure handling                                                                                    |
| ------------- | ------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `credentials` | `email`, `password`                         | non-PATIENT users where `deletedAt IS NULL` | bcrypt compare → on miss `failedLoginAttempts++`; at 10 → `lockedUntil = now + 15m`, counter resets |
| `phone-otp`   | `phone` (`+9627XXXXXXXX`), `otp` (6 digits) | PATIENT users where `deletedAt IS NULL`     | OTP verify via `lib/auth/otp.ts` (Redis) → same lockout pattern on miss                             |

`loginWithCredentials` and `verifyOtpAndSignIn` (in `lib/auth/actions/login.ts`)
re-check lockout state after the provider call so the UI shows
`ACCOUNT_LOCKED` rather than `INVALID_CREDENTIALS` once the 10-strike
threshold is hit (lockout existence is no longer a secret at that point).

## OTP flow

| Step     | Where                        | Details                                                                                                         |
| -------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Generate | `lib/auth/otp.ts`            | `crypto.randomInt(0, 1e6)` → 6 zero-padded digits                                                               |
| Store    | Redis `otp:{phone}`          | bcrypt hash + attempts counter, TTL 300s                                                                        |
| Cooldown | Redis `otp:cooldown:{phone}` | 60-second guard so one phone cannot flood SMS sends                                                             |
| Verify   | `lib/auth/otp.ts`            | `bcrypt.compare`; success deletes key; 3 misses → `OTP_LOCKED`                                                  |
| Send     | `lib/auth/senders/*`         | env-selected: `console` in dev (writes `[DEV OTP] phone=... otp=...` to stderr) or `whatsapp` (stub — Prompt 8) |

The request endpoint always returns `ok:true` past the cooldown check — so
the _request_ phase never reveals whether the phone is registered. Only
the eventual verify call returns `OTP_EXPIRED` for unregistered numbers
(same as a real-but-expired key).

## Middleware

`middleware.ts` composes:

1. `createIntlMiddleware(routing)` — locale prefix and detection (Prompt 3).
2. `auth(...)` — wraps the request with Auth.js session reading.

Rules applied to the locale-stripped bare path:

| Condition                                                                                                | Effect                                    |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Bare path is in `PUBLIC_PATHS`                                                                           | Pass through                              |
| No session AND not public                                                                                | Redirect to `/<locale>/login?from=<bare>` |
| Session exists AND bare path is `/login` or `/forgot-password` AND user does NOT need to change password | Redirect to `/<locale>/<ROLE_HOME[role]>` |
| Session exists AND `mustChangePassword=true` AND bare path NOT in `PASSWORD_GATE_ALLOWLIST`              | Redirect to `/<locale>/change-password`   |

`PUBLIC_PATHS`, `PASSWORD_GATE_ALLOWLIST`, and `ROLE_HOME` live in
[`lib/auth/routes.ts`](../../lib/auth/routes.ts).

## RBAC

See [`lib/rbac/permissions.ts`](../../lib/rbac/permissions.ts) for the
permission catalogue (every code in spec §4.1, expressed verbatim) and
[`lib/rbac/__tests__/can.test.ts`](../../lib/rbac/__tests__/can.test.ts) for
the 289-case exhaustive matrix test.

Code format `{resource}.{action}[.{scope}]`. Scopes:

| Scope                       | Meaning                                 | Resource fields used by `can()`                   |
| --------------------------- | --------------------------------------- | ------------------------------------------------- |
| (none)                      | Role grant is sufficient                | —                                                 |
| `.own`                      | Actor is the resource owner             | `resource.ownerId === user.id`                    |
| `.assigned`                 | Actor is in the assigned clinician list | `resource.assignedClinicianIds.includes(user.id)` |
| `.limited`                  | Owner-scoped redacted view              | same as `.own`                                    |
| `.patients` / `.therapists` | Role-broad sub-grant (secretary)        | —                                                 |

Use [`requirePermission(action, resource?)`](../../lib/rbac/guards.ts) at the
top of every server action and protected route handler. Use
[`<Can action="...">`](../../components/rbac/Can.tsx) in client UI.

## Audit log

Every state-changing service function is wrapped with
[`withAudit(...)`](../../lib/audit/withAudit.ts). The wrapper writes one
`AuditLog` row per successful call (actor, entity, action, before/after).
On a thrown error the audit row is skipped — we audit committed state,
not attempts.

The canonical example in this prompt is
[`lib/auth/services/changePassword.ts`](../../lib/auth/services/changePassword.ts) —
copy that pattern when adding a new service function.

CI cannot enforce `withAudit` use. **Code review must.** The
`docs/audit/README.md` checklist covers what to verify on every PR that adds a
service function.

## Known caveats (Auth.js v5 beta)

1. **JWT module augmentation broken under pnpm.** The declared module path
   `@auth/core/jwt` resolves to two different `@auth/core` versions on disk
   (one pulled in directly, one nested under next-auth), and TS's
   `declare module '@auth/core/jwt'` cannot find a stable target. Workaround:
   `lib/auth/types.ts` exposes `asAppJwt()` / `writeAppJwt()` helpers that
   cast the raw JWT to the clinic-specific fields at call sites. Same
   runtime behaviour, fully typed reads.
2. **Edge / Node config split required.** Documented above; the Auth.js v5
   migration guide calls this pattern out under "Edge compatibility".
3. **Provider error surface is opaque.** Auth.js v5's `signIn()` throws a
   generic `AuthError` for any provider failure. To surface specific reasons
   (locked vs invalid) the server action re-queries the User row after the
   throw.

## Environment

| Variable          | Required                       | Purpose                                         |
| ----------------- | ------------------------------ | ----------------------------------------------- |
| `AUTH_SECRET`     | Yes                            | Signs the JWT cookie. `openssl rand -base64 32` |
| `AUTH_URL`        | Production                     | Canonical origin for callbacks                  |
| `AUTH_TRUST_HOST` | Behind a proxy / non-localhost | Set `"true"`                                    |
| `OTP_SENDER`      | Yes                            | `console` (dev) or `whatsapp` (Prompt 8)        |
| `REDIS_URL`       | Yes                            | OTP storage + rate limiting                     |
| `DATABASE_URL`    | Yes                            | Adapter + provider lookups                      |
