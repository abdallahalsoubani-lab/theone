import { setRequestLocale } from 'next-intl/server';

import { LeavesBoard } from '@/components/leave/LeavesBoard';
import { listActiveClinicians } from '@/lib/appointments/queries';
import { listAllLeaves } from '@/lib/leave/queries';
import { can } from '@/lib/rbac/can';
import { requirePermission } from '@/lib/rbac/guards';

/**
 * Secretary leave management (Prompt 55 §1) — the secretary runs the schedule
 * day-to-day and is who hears "الدكتورة مش جاية بكرا" first. Same shared board
 * as /admin/leaves; approve/reject stays admin-only (`leaves.update`), the
 * secretary gets direct add + delete (`leaves.create` / `leaves.delete`).
 */
export default async function SecretaryLeavesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission('leaves.read');
  const [rows, clinicians] = await Promise.all([listAllLeaves({}), listActiveClinicians()]);
  return (
    <LeavesBoard
      rows={rows}
      clinicians={clinicians}
      canApprove={can(viewer, 'leaves.update')}
      canManage={can(viewer, 'leaves.create')}
    />
  );
}
