import { LogIn } from 'lucide-react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Static previews of header state, locked-account banner, must-change banner.
 * Pure CSS — these don't render real session UI, just the visual shapes
 * Prompt 4 lands so future prompts have a consistent inventory to copy from.
 */
export function AuthStates() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardContent className="space-y-3 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-brand-textMuted">
            Anonymous header
          </p>
          <div className="flex items-center gap-3 rounded-md border border-brand-border bg-brand-surface px-3 py-2">
            <span className="font-medium text-brand-navy">Theone.pt</span>
            <Button size="sm" className="ms-auto">
              <LogIn className="me-2 size-4" /> Sign in
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-brand-textMuted">
            Authenticated header
          </p>
          <div className="flex items-center gap-3 rounded-md border border-brand-border bg-brand-surface px-3 py-2">
            <span className="font-medium text-brand-navy">Theone.pt</span>
            <div className="ms-auto flex items-center gap-2">
              <Badge variant="cyan">ADMIN</Badge>
              <Avatar>
                <AvatarFallback>SK</AvatarFallback>
              </Avatar>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-brand-textMuted">
            Locked-account banner
          </p>
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            This account is temporarily locked. Try again in 15 minutes.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-brand-textMuted">
            Must-change-password banner
          </p>
          <div className="rounded-md bg-brand-bg px-3 py-2 text-sm text-brand-navy">
            Your password must be changed before continuing.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
