'use client';

import { useTranslations } from 'next-intl';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import type { ReferralRow } from '@/lib/analytics/queries';

interface Props {
  data: ReferralRow[];
}

const PALETTE = ['#0EA5B7', '#10B981', '#F59E0B', '#DC2626', '#6366F1', '#EC4899', '#5A6580'];

export function ReferralDonut({ data }: Props) {
  const t = useTranslations('analytics.referrals');
  return (
    <div className="rounded-lg border border-brand-border bg-brand-surface p-4">
      <h3 className="mb-2 text-sm font-medium text-brand-navy">{t('title')}</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="source"
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={90}
              paddingAngle={2}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
