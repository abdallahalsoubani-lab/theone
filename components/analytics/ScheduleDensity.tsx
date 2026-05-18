'use client';

import { useTranslations } from 'next-intl';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { ScheduleDensityRow } from '@/lib/analytics/queries';

interface Props {
  data: ScheduleDensityRow[];
}

export function ScheduleDensity({ data }: Props) {
  const t = useTranslations('analytics.schedule');
  return (
    <div className="rounded-lg border border-brand-border bg-brand-surface p-4">
      <h3 className="mb-2 text-sm font-medium text-brand-navy">{t('title')}</h3>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#D8DEE8" />
            <XAxis dataKey="day" stroke="#5A6580" fontSize={10} />
            <YAxis stroke="#5A6580" fontSize={12} />
            <Tooltip />
            <Bar dataKey="minutes" fill="#0EA5B7" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
