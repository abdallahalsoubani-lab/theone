'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * Suppresses the app shell (Header / Footer) on the marketing landing, which
 * brings its own nav + footer. The landing is the locale root (`/en` | `/ar`);
 * every other route keeps the app chrome. usePathname resolves identically on
 * server and client, so there's no hydration mismatch or flash.
 */
export function ChromeGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isLanding = /^\/(en|ar)\/?$/.test(pathname ?? '');
  if (isLanding) return null;
  return <>{children}</>;
}
