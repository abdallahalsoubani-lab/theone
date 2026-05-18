import { setRequestLocale } from 'next-intl/server';

import { AdminLeavesBoard } from '@/components/leave/AdminLeavesBoard';
import { listAllLeaves } from '@/lib/leave/queries';
import { requirePermission } from '@/lib/rbac/guards';

export default async function AdminLeavesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('leaves.read');
  const rows = await listAllLeaves({});
  return <AdminLeavesBoard rows={rows} />;
}
