'use client';

import { useTranslations } from 'next-intl';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { TrendBucket } from '@/lib/analytics/queries';

interface Props {
  data: TrendBucket[];
}

/**
 * Monthly trend line — booked vs completed vs cancelled appointments.
 * The clinic's operational health at a glance.
 */
export function TrendLine({ data }: Props) {
  const t = useTranslations('analytics.trend');
  return (
    <div className="rounded-lg border border-brand-border bg-brand-surface p-4">
      <h3 className="mb-2 text-sm font-medium text-brand-navy">{t('title')}</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#D8DEE8" />
            <XAxis dataKey="month" stroke="#5A6580" fontSize={12} />
            <YAxis stroke="#5A6580" fontSize={12} allowDecimals={false} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="booked" stroke="#0EA5B7" name={t('booked')} />
            <Line type="monotone" dataKey="completed" stroke="#10B981" name={t('completed')} />
            <Line type="monotone" dataKey="cancelled" stroke="#DC2626" name={t('cancelled')} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
