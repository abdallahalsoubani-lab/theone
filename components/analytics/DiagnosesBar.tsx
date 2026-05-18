'use client';

import { useTranslations } from 'next-intl';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { DiagnosisRow } from '@/lib/analytics/queries';

interface Props {
  data: DiagnosisRow[];
}

export function DiagnosesBar({ data }: Props) {
  const t = useTranslations('analytics.diagnoses');
  return (
    <div className="rounded-lg border border-brand-border bg-brand-surface p-4">
      <h3 className="mb-2 text-sm font-medium text-brand-navy">{t('title')}</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#D8DEE8" />
            <XAxis type="number" stroke="#5A6580" fontSize={12} allowDecimals={false} />
            <YAxis type="category" dataKey="diagnosis" stroke="#5A6580" fontSize={12} width={140} />
            <Tooltip />
            <Bar dataKey="count" fill="#0EA5B7" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
