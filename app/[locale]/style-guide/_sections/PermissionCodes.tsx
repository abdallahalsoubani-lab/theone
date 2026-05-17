import { UserRole } from '@prisma/client';

import { Card, CardContent } from '@/components/ui/card';
import { ROLE_PERMISSIONS, listPermissions } from '@/lib/rbac/permissions';

/**
 * Static permission-matrix table. Regenerated automatically from the
 * ROLE_PERMISSIONS map — adding a code to a role's set updates the table
 * with no further work.
 */
const ROLES = Object.values(UserRole);

export function PermissionCodes() {
  const codes = listPermissions();
  return (
    <Card>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full border-collapse text-sm">
          <thead className="border-b border-brand-border bg-brand-bg text-start text-xs uppercase tracking-wider text-brand-textMuted">
            <tr>
              <th className="px-3 py-2 text-start font-medium">Permission code</th>
              {ROLES.map((r) => (
                <th key={r} className="px-3 py-2 text-center font-medium">
                  {r}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {codes.map((code) => (
              <tr key={code} className="border-b border-brand-border last:border-b-0">
                <td className="px-3 py-1.5 font-mono text-xs text-brand-navy">{code}</td>
                {ROLES.map((r) => (
                  <td key={r} className="px-3 py-1.5 text-center">
                    {ROLE_PERMISSIONS[r].has(code) ? (
                      <span className="text-brand-teal" aria-label="allowed">
                        ✓
                      </span>
                    ) : (
                      <span className="text-brand-textMuted" aria-label="denied">
                        ·
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
