import type { ReactNode } from 'react';

import { Logo } from '@/components/brand/Logo';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Stripped-down layout for auth pages. The outer site Header and Footer come
 * from `[locale]/layout.tsx`; this layer just provides the centered card.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[calc(100vh-16rem)] items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md shadow-sm">
        <CardContent className="space-y-6 p-6 sm:p-8">
          <div className="flex justify-center">
            <Logo size={64} />
          </div>
          {children}
        </CardContent>
      </Card>
    </div>
  );
}
