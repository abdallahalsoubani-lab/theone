import type { NextAuthConfig } from 'next-auth';

import { asAppJwt, writeAppJwt, type AppJwtFields } from './types';

/**
 * Edge-safe Auth.js config — used by the middleware only.
 *
 * The full config (`./config.ts`) pulls in the Prisma adapter, bcryptjs, and
 * Redis through the providers — none of which work under Edge runtime.
 * Splitting the config in two is the documented Auth.js v5 pattern for
 * middleware-aware projects.
 *
 * The middleware never validates credentials or hits the DB; it just decrypts
 * the JWT, runs the jwt/session callbacks, and reads role / mustChangePassword
 * for routing decisions. So providers and adapter can both be empty here.
 *
 * Keep the jwt/session callbacks IN SYNC with `./config.ts`. The two configs
 * read the same cookie, so divergence breaks routing.
 */
export const authEdgeConfig: NextAuthConfig = {
  session: { strategy: 'jwt' },
  trustHost: process.env.AUTH_TRUST_HOST === 'true' || process.env.NODE_ENV !== 'production',
  providers: [],
  callbacks: {
    async jwt({ token, user, trigger, session: triggerSession }) {
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
