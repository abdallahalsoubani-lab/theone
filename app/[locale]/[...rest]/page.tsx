import { notFound } from 'next/navigation';

/**
 * Catch-all under `[locale]` so unmatched URLs render the localized
 * `[locale]/not-found.tsx` (with the proper shell and translations) instead
 * of bubbling to Next's framework-default 404.
 *
 * Without this file, a URL like `/ar/no-such-page` falls all the way to the
 * root `app/_not-found` which has no NextIntlClientProvider and no layout.
 */
export default function CatchAll() {
  notFound();
}
