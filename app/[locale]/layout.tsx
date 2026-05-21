import type { Metadata } from 'next';
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { Inter, IBM_Plex_Sans_Arabic } from 'next/font/google';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { ImpersonationBanner } from '@/components/impersonation/ImpersonationBanner';
import { SessionProvider } from '@/components/providers/SessionProvider';
import { Footer } from '@/components/shell/Footer';
import { Header } from '@/components/shell/Header';
import { Toaster } from '@/components/ui/sonner';
import { routing } from '@/i18n/routing';
import { cn } from '@/lib/utils';

import '../globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
  weight: ['400', '500'],
});

const arabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  display: 'swap',
  variable: '--font-arabic',
  weight: ['400', '500'],
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const safeLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: safeLocale, namespace: 'common' });
  return {
    title: { default: t('appName'), template: `%s · ${t('appName')}` },
    icons: { icon: '/logo.svg' },
  };
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);
  const messages = await getMessages();
  const t = await getTranslations({ locale, namespace: 'navigation' });

  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const bodyFont = locale === 'ar' ? 'font-arabic' : 'font-sans';

  return (
    <html lang={locale} dir={dir} className={`${inter.variable} ${arabic.variable}`}>
      <body className={cn('flex min-h-screen flex-col', bodyFont)}>
        <NextIntlClientProvider messages={messages} locale={locale}>
          <SessionProvider>
            <a
              href="#main-content"
              className="sr-only z-50 rounded-md bg-brand-navy px-3 py-2 text-sm text-white focus:not-sr-only focus:absolute focus:start-4 focus:top-4"
            >
              {t('skipToContent')}
            </a>
            <ImpersonationBanner />
            <Header />
            <main id="main-content" className="flex-1">
              {children}
            </main>
            <Footer />
            <Toaster />
          </SessionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
