import { PrismaAdapter } from '@auth/prisma-adapter';
import type { NextAuthConfig } from 'next-auth';

import { db } from '@/lib/db';

import { providers } from './providers';
import { asAppJwt, writeAppJwt, type AppJwtFields } from './types';

/**
 * Auth.js v5 configuration.
 *
 * IMPORTANT: Auth.js v5 is in beta. The shape of this config (providers array,
 * callbacks signature, NextAuth() return shape) may shift before GA — see
 * docs/auth/README.md for the pinned version and known caveats.
 *
 * Providers are added in commit 2 of Prompt 4. Keeping them empty here lets
 * the rest of the wiring land first and keeps provider-specific logic
 * (lockout, OTP verification) testable in isolation.
 */
export const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(db),
  session: {
    strategy: 'jwt',
    maxAge: 7 * 24 * 60 * 60, // 7 days — see Prompt 0 §3
    updateAge: 24 * 60 * 60, // refresh JWT once per day on activity
  },
  pages: {
    signIn: '/login',
    signOut: '/login',
    error: '/login',
  },
  trustHost: process.env.AUTH_TRUST_HOST === 'true' || process.env.NODE_ENV !== 'production',
  providers,
  callbacks: {
    async jwt({ token, user, trigger, session: triggerSession }) {
      // Initial sign-in — copy our custom fields from the User row.
      if (user) {
        writeAppJwt(token, {
          userId: user.id ?? '',
          role: user.role,
          languagePref: user.languagePref,
          mustChangePassword: user.mustChangePassword,
          fullNameEn: user.fullNameEn,
          fullNameAr: user.fullNameAr,
        });
      }
      // Allow client-side update() calls to refresh languagePref and the
      // mustChangePassword flag without forcing a re-login.
      if (trigger === 'update' && triggerSession && typeof triggerSession === 'object') {
        const next = triggerSession as Partial<AppJwtFields>;
        const patch: Partial<AppJwtFields> = {};
        if (next.languagePref) patch.languagePref = next.languagePref;
        if (typeof next.mustChangePassword === 'boolean') {
          patch.mustChangePassword = next.mustChangePassword;
        }
        writeAppJwt(token, patch);
      }
      return token;
    },
    async session({ session, token }) {
      const app = asAppJwt(token);
      if (!app.role || !app.languagePref) return session;
      session.user = {
        ...session.user,
        id: app.userId ?? '',
        role: app.role,
        languagePref: app.languagePref,
        mustChangePassword: app.mustChangePassword ?? false,
        fullNameEn: app.fullNameEn ?? '',
        fullNameAr: app.fullNameAr ?? '',
      };
      return session;
    },
  },
};
