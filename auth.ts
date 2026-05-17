import NextAuth from 'next-auth';

import { authConfig } from '@/lib/auth/config';

/**
 * Auth.js v5 root export. Place this file at the repo root (not under
 * `lib/auth/`) so the Next-Auth tooling picks it up via the conventional
 * `auth` import path. The route handler at `app/api/auth/[...nextauth]/route.ts`
 * re-exports `handlers.GET` and `handlers.POST`.
 *
 * Server components and server actions read the current session via:
 *   const session = await auth();
 *   if (!session?.user) ...
 *
 * Client components use `useSession()` from `next-auth/react`.
 */
export const { auth, signIn, signOut, handlers } = NextAuth(authConfig);
