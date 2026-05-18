'use client';

import { useTranslations } from 'next-intl';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { ComplianceTrendPoint } from '@/lib/analytics/queries';

interface Props {
  data: ComplianceTrendPoint[];
}

export function ComplianceTrend({ data }: Props) {
  const t = useTranslations('analytics.compliance');
  return (
    <div className="rounded-lg border border-brand-border bg-brand-surface p-4">
      <h3 className="mb-2 text-sm font-medium text-brand-navy">{t('title')}</h3>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#D8DEE8" />
            <XAxis dataKey="date" stroke="#5A6580" fontSize={10} />
            <YAxis stroke="#5A6580" fontSize={12} domain={[0, 100]} />
            <Tooltip />
            <Area type="monotone" dataKey="rate" stroke="#10B981" fill="#10B98133" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
