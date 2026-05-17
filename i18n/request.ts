import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';

import { routing } from './routing';

/**
 * Server-side request config consumed by next-intl per RSC render.
 *
 * `requestLocale` is whatever the middleware resolved (URL segment first,
 * cookie + Accept-Language fallback for new visitors). If something invalid
 * leaks through, fall back to the default locale rather than throwing —
 * deep links to bogus locales get the default-locale shell, not a crash.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
