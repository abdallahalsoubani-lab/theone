import type { LanguagePref, UserRole } from '@prisma/client';
import type { DefaultSession } from 'next-auth';

/**
 * Module augmentation for next-auth's User and Session shapes — adds the
 * clinic-specific fields we copy into the JWT and Session at login.
 *
 * The matching JWT shape is in `AppJWT` below rather than a module
 * augmentation because Auth.js v5 nests its JWT type under
 * `@auth/core/jwt`, which under pnpm's strict layout pulls two different
 * @auth/core versions onto disk and breaks the augmentation declaration.
 * The callback in `lib/auth/config.ts` adapts the raw JWT through
 * `asAppJwt()` so the rest of the code stays typed.
 */
declare module 'next-auth' {
  interface User {
    role: UserRole;
    languagePref: LanguagePref;
    mustChangePassword: boolean;
    fullNameEn: string;
    fullNameAr: string;
  }

  interface Session {
    user: DefaultSession['user'] & {
      id: string;
      role: UserRole;
      languagePref: LanguagePref;
      mustChangePassword: boolean;
      fullNameEn: string;
      fullNameAr: string;
    };
  }
}

export interface AppJwtFields {
  userId: string;
  role: UserRole;
  languagePref: LanguagePref;
  mustChangePassword: boolean;
  fullNameEn: string;
  fullNameAr: string;
}

/**
 * View the raw next-auth JWT as the clinic-specific shape. The underlying
 * object is the same — we just narrow the read sites so token.role etc.
 * stay typed.
 */
export function asAppJwt<T>(token: T): T & Partial<AppJwtFields> {
  return token as T & Partial<AppJwtFields>;
}

/** Mutating writer — assigns the fields without `as any` at the call site. */
export function writeAppJwt<T extends object>(token: T, values: Partial<AppJwtFields>): void {
  Object.assign(token, values);
}
