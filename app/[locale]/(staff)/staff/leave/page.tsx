import { setRequestLocale } from 'next-intl/server';

import { auth } from '@/auth';
import { LeaveListBoard } from '@/components/leave/LeaveListBoard';
import { can } from '@/lib/rbac/can';
import { requirePermission } from '@/lib/rbac/guards';
import { listLeavesForUser } from '@/lib/leave/queries';

export default async function StaffLeavePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('leaves.read.own');
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }
  const rows = await listLeavesForUser(session.user.id);
  const canRequest = can({ id: session.user.id, role: session.user.role }, 'leaves.create.own', {
    ownerId: session.user.id,
  });
  return <LeaveListBoard rows={rows} canRequest={canRequest} />;
}
