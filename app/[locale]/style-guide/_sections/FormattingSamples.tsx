import { getTranslations } from 'next-intl/server';

import { Card, CardContent } from '@/components/ui/card';
import {
  formatDate,
  formatDateTime,
  formatRelative,
  formatShortDate,
  formatTime,
} from '@/lib/format/date';
import { formatNumber } from '@/lib/format/number';
import { formatPhone } from '@/lib/format/phone';
import type { AppLocale } from '@/lib/format/locale';

const sampleAppointment = new Date('2026-06-01T14:30:00Z');
const samplePhone = '+962790123456';
const sampleNumber = 1_234_567;

export async function FormattingSamples({ locale }: { locale: AppLocale }) {
  const t = await getTranslations('styleGuide.samples');
  // Use a fixed `now` so relative output is reproducible across renders.
  const now = new Date('2026-05-30T14:00:00Z');
  return (
    <Card>
      <CardContent className="grid gap-3 p-6 sm:grid-cols-2">
        <Row label={t('longDate')}>{formatDate(sampleAppointment, locale)}</Row>
        <Row label={t('shortDate')}>{formatShortDate(sampleAppointment, locale)}</Row>
        <Row label={t('time')}>{formatTime(sampleAppointment, locale)}</Row>
        <Row label={t('relative')}>{formatRelative(sampleAppointment, locale, now)}</Row>
        <Row label={t('number')}>{formatNumber(sampleNumber, locale)}</Row>
        <Row label={t('phone')}>{formatPhone(samplePhone)}</Row>
        <Row label="formatDateTime">{formatDateTime(sampleAppointment, locale)}</Row>
        <Row label="Hijri (islamic-umalqura)">
          {formatDate(sampleAppointment, locale, { calendar: 'islamic-umalqura' })}
        </Row>
      </CardContent>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1 text-sm">
      <p className="text-xs uppercase tracking-wide text-brand-textMuted">{label}</p>
      <p className="font-medium text-brand-navy">{children}</p>
    </div>
  );
}
