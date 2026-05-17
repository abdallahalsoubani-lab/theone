import { Card, CardContent } from '@/components/ui/card';
import { AUTH_ERRORS } from '@/lib/auth/result';

/**
 * Inline + toast preview of every auth-flow error code. The list is generated
 * from AUTH_ERRORS so adding a new code automatically shows up here.
 */
export function ErrorStates() {
  const codes = Object.values(AUTH_ERRORS);
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {codes.map((e) => (
        <Card key={e.code}>
          <CardContent className="space-y-2 p-4 text-sm">
            <div className="flex items-center justify-between gap-2">
              <code className="text-xs text-brand-navy">{e.code}</code>
            </div>
            <p className="text-brand-text">{e.message_en}</p>
            <p className="font-arabic text-brand-textMuted" dir="rtl">
              {e.message_ar}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
