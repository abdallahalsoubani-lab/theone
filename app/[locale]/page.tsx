import { Cairo, Outfit, Plus_Jakarta_Sans } from 'next/font/google';
import { setRequestLocale } from 'next-intl/server';

import { LandingPage } from '@/components/landing/LandingPage';

/**
 * Public landing page (the clinic's marketing home).
 *
 * Logged-out visitors see the landing; authenticated users are bounced to
 * their role home by the middleware (so this stays a fast, static page). The
 * app Header/Footer are suppressed on this route (ChromeGate) — the landing
 * brings its own nav + footer.
 */

// Marketing fonts, wired to the CSS variables landing.css references.
const display = Outfit({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  variable: '--font-display',
  display: 'swap',
});
const body = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
  display: 'swap',
});
const arabic = Cairo({
  subsets: ['arabic'],
  weight: ['400', '600', '700', '800', '900'],
  variable: '--font-ar',
  display: 'swap',
});

export default async function LocaleHomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <LandingPage fontClass={`${display.variable} ${body.variable} ${arabic.variable}`} />;
}
