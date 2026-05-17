'use client';

import { SessionProvider as NextAuthSessionProvider } from 'next-auth/react';
import type { ReactNode } from 'react';

/**
 * Client wrapper exposing the next-auth `useSession()` hook tree-wide.
 * Mounted at the root of the locale layout so every client component below
 * can read the current session without prop drilling.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  return <NextAuthSessionProvider>{children}</NextAuthSessionProvider>;
}
