import NextAuth from 'next-auth';

import { authEdgeConfig } from '@/lib/auth/edge-config';

/**
 * Edge-runtime Auth.js export. Used exclusively by `middleware.ts` (which Next
 * runs in the Edge runtime). The middleware only reads the JWT — it never
 * touches Prisma, bcrypt, or Redis — so the full config in `./auth.ts` is not
 * required (and would crash the build, because the Prisma adapter and bcryptjs
 * both import Node-only modules).
 */
export const { auth } = NextAuth(authEdgeConfig);
