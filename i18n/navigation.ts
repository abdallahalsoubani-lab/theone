import { createNavigation } from 'next-intl/navigation';

import { routing } from './routing';

/**
 * Locale-aware re-exports of next/navigation APIs. Use these everywhere instead
 * of importing from `next/navigation` directly — they automatically prepend the
 * active locale, so `<Link href="/style-guide" />` resolves to `/<locale>/style-guide`
 * without per-call boilerplate, and `useRouter().push(...)` does the same.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
