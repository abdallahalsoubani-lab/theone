import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Logo } from '@/components/brand/Logo';
import { LanguageToggle } from '@/components/shell/LanguageToggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { DirectionalIcon } from '@/components/ui/DirectionalIcon';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import type { AppLocale } from '@/lib/format/locale';

import { BilingualPreview } from './_sections/BilingualPreview';
import { FormattingSamples } from './_sections/FormattingSamples';

/**
 * Internal style guide.
 *
 * Mixed-language by design: shell + section titles flow through next-intl
 * (Prompt 3 §4.12); the demo content inside each section stays in English
 * because the page documents the design system, not the localized app.
 * Grows with the system — Prompt 7 will add a calendar widget preview, etc.
 */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'styleGuide' });
  return { title: t('title') };
}

const BRAND_TOKENS: ReadonlyArray<{
  name: string;
  hex: string;
  cssVar: string;
  usage: string;
}> = [
  {
    name: 'brand.navy',
    hex: '#0B1E47',
    cssVar: '--brand-navy',
    usage: 'Primary actions, headers, hero backgrounds',
  },
  {
    name: 'brand.navyDeep',
    hex: '#091638',
    cssVar: '--brand-navy-deep',
    usage: 'Hover state on navy buttons',
  },
  {
    name: 'brand.blue',
    hex: '#1B4982',
    cssVar: '--brand-blue',
    usage: 'Secondary surfaces, gradient start',
  },
  {
    name: 'brand.teal',
    hex: '#1E5F58',
    cssVar: '--brand-teal',
    usage: 'Success states, highlight cards',
  },
  {
    name: 'brand.cyan',
    hex: '#3DC0D9',
    cssVar: '--brand-cyan',
    usage: 'Icons, gradient end, links, accents',
  },
  {
    name: 'brand.cyanLight',
    hex: '#7DDBE9',
    cssVar: '--brand-cyan-light',
    usage: 'Hover state on cyan',
  },
  { name: 'brand.bg', hex: '#F2F4F8', cssVar: '--brand-bg', usage: 'Page background' },
  {
    name: 'brand.surface',
    hex: '#FFFFFF',
    cssVar: '--brand-surface',
    usage: 'Cards, modals, elevated surfaces',
  },
  {
    name: 'brand.text',
    hex: '#0B1E47',
    cssVar: '--brand-text',
    usage: 'Body text on light surfaces',
  },
  {
    name: 'brand.textMuted',
    hex: '#5A6580',
    cssVar: '--brand-text-muted',
    usage: 'Secondary text, captions',
  },
  {
    name: 'brand.border',
    hex: '#D8DEE8',
    cssVar: '--brand-border',
    usage: 'Card borders, dividers',
  },
];

const SPACING_STEPS: ReadonlyArray<{ step: number; px: number; tw: string }> = [
  { step: 1, px: 4, tw: 'w-1' },
  { step: 2, px: 8, tw: 'w-2' },
  { step: 4, px: 16, tw: 'w-4' },
  { step: 8, px: 32, tw: 'w-8' },
  { step: 16, px: 64, tw: 'w-16' },
];

export default async function StyleGuidePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sg = await getTranslations('styleGuide');
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  return (
    <div className="mx-auto max-w-6xl space-y-16 px-6 py-12">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Logo size={56} />
          <div>
            <h1 className="text-3xl font-medium text-brand-navy">{sg('title')}</h1>
            <p className="text-sm text-brand-textMuted">{sg('subtitle')}</p>
          </div>
        </div>
        <Badge variant="teal">Phase 0 · Foundation</Badge>
      </header>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
          <div className="flex items-center gap-3">
            <DirectionalIcon name="chevron-end" className="size-4 text-brand-cyan" />
            <p className="text-sm text-brand-textMuted">
              {sg('directionLabel', { dir })} — <code>{locale}</code>
            </p>
          </div>
          <LanguageToggle />
        </CardContent>
      </Card>

      <Section
        title={sg('bilingualPreview')}
        description="Same content side by side in en (LTR) and ar (RTL) for visual QA."
      >
        <BilingualPreview />
      </Section>

      <Section
        title={sg('formatting')}
        description="Outputs from lib/format/* in the active locale."
      >
        <FormattingSamples locale={locale as AppLocale} />
      </Section>

      <Separator />

      <Section
        title={sg('colors')}
        description="Eleven locked tokens. Both Tailwind classes and CSS variables resolve to these values."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {BRAND_TOKENS.map((token) => (
            <Card key={token.name}>
              <CardContent className="space-y-3 p-4">
                <div
                  className="h-20 w-full rounded-md border border-brand-border"
                  style={{ backgroundColor: token.hex }}
                  aria-hidden="true"
                />
                <div className="space-y-1 text-sm">
                  <div className="flex items-center justify-between font-medium text-brand-navy">
                    <span>{token.name}</span>
                    <code className="text-xs text-brand-textMuted">{token.hex}</code>
                  </div>
                  <code className="block text-xs text-brand-textMuted">{token.cssVar}</code>
                  <p className="text-xs text-brand-textMuted">{token.usage}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>

      <Section
        title={sg('ctaGradient')}
        description="Primary call-to-action surface — locked gradient direction."
      >
        <div className="flex h-24 items-center justify-center rounded-lg bg-gradient-cta text-lg font-medium text-white shadow-sm">
          bg-gradient-cta
        </div>
      </Section>

      <Section
        title={sg('typography')}
        description="Inter for Latin, IBM Plex Sans Arabic for Arabic. Weights 400 and 500 only."
      >
        <Card>
          <CardContent className="space-y-4 p-6">
            <h1 className="text-5xl font-medium">Heading 1 — quick brown fox</h1>
            <h2 className="text-4xl font-medium">Heading 2 — quick brown fox</h2>
            <h3 className="text-3xl font-medium">Heading 3 — quick brown fox</h3>
            <h4 className="text-2xl font-medium">Heading 4 — quick brown fox</h4>
            <h5 className="text-xl font-medium">Heading 5 — quick brown fox</h5>
            <h6 className="text-lg font-medium">Heading 6 — quick brown fox</h6>
            <p className="text-lg">
              Body large — sentence-case copy used for high-emphasis paragraphs.
            </p>
            <p className="text-base">Body — default 16px, line-height 1.6, weight 400.</p>
            <p className="text-sm">Small — used for secondary details and labels.</p>
            <p className="text-xs text-brand-textMuted">
              Caption — timestamps, helper text, footnotes.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3 p-6 font-arabic" dir="rtl">
            <h2 className="text-4xl font-medium">المركز الأول للعلاج الطبيعي</h2>
            <p className="text-lg">هذا نص اختباري لعرض الخط العربي ضمن نظام التصميم.</p>
            <p>الجملة الافتراضية بحجم ١٦ بكسل لاستعراض الوزن العادي.</p>
            <p className="text-sm text-brand-textMuted">نص ثانوي للملاحظات والتعليقات.</p>
          </CardContent>
        </Card>
      </Section>

      <Section title={sg('buttons')} description="All shadcn variants plus the brand CTA gradient.">
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-6">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="link">Link</Button>
            <button
              type="button"
              className="inline-flex h-10 items-center rounded-md bg-gradient-cta px-6 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              CTA gradient
            </button>
            <Button disabled>Disabled</Button>
          </CardContent>
        </Card>
      </Section>

      <Section title={sg('forms')} description="Input + Label, plus disabled and error states.">
        <Card>
          <CardContent className="grid gap-4 p-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sg-name">Patient name</Label>
              <Input id="sg-name" placeholder="e.g. Sara Khalil" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sg-disabled">Disabled input</Label>
              <Input id="sg-disabled" placeholder="Not editable" disabled />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="sg-error">Phone (with error)</Label>
              <Input
                id="sg-error"
                placeholder="+962 7..."
                aria-invalid
                aria-describedby="sg-error-help"
              />
              <p id="sg-error-help" className="text-xs text-destructive">
                Enter a valid Jordanian mobile number.
              </p>
            </div>
          </CardContent>
        </Card>
      </Section>

      <Section
        title={sg('cards')}
        description="Three reference layouts: basic, header + footer, elevated."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardContent className="p-6">
              <p className="font-medium text-brand-navy">Basic card</p>
              <p className="text-sm text-brand-textMuted">Single block of content, no chrome.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>With header and footer</CardTitle>
              <CardDescription>Used for forms and grouped settings.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-brand-textMuted">
                The header carries the title; the footer holds primary and secondary actions.
              </p>
            </CardContent>
            <CardFooter className="gap-2">
              <Button size="sm">Save</Button>
              <Button size="sm" variant="ghost">
                Cancel
              </Button>
            </CardFooter>
          </Card>
          <Card className="shadow-md">
            <CardHeader>
              <CardTitle>Elevated</CardTitle>
              <CardDescription>For modals, popovers, dropdowns.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-brand-textMuted">
                Same anatomy, deeper shadow signals lift above the page surface.
              </p>
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section title={sg('badges')} description="Status, category, and counter chips.">
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 p-6">
            <Badge>Default · navy</Badge>
            <Badge variant="teal">Teal · success</Badge>
            <Badge variant="cyan">Cyan · accent</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="muted">Muted · gray</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="destructive">Destructive</Badge>
          </CardContent>
        </Card>
      </Section>

      <Section
        title={sg('spacing')}
        description="Tailwind spacing tokens used in the system (multiples of 4px)."
      >
        <Card>
          <CardContent className="space-y-3 p-6">
            {SPACING_STEPS.map((step) => (
              <div key={step.step} className="flex items-center gap-4 text-sm">
                <code className="w-16 text-brand-textMuted">{step.tw}</code>
                <div className={`${step.tw} h-3 rounded-sm bg-brand-cyan`} />
                <span className="text-brand-textMuted">
                  {step.px}px · spacing-{step.step}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </Section>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-medium text-brand-navy">{title}</h2>
        {description ? <p className="text-sm text-brand-textMuted">{description}</p> : null}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
