'use client';

import { Menu } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

import type { NavLink } from './Sidebar';

/**
 * Mobile drawer nav (Prompt 3 §4.5).
 *
 * Renders only below md. Sheet slides in from the inline-start corner so it
 * appears on the natural side under both LTR (left) and RTL (right).
 * Same `links` API as Sidebar — feature pages reuse the same array.
 */
export function MobileNav({ links }: { links: ReadonlyArray<NavLink> }) {
  const [open, setOpen] = useState(false);
  const t = useTranslations('navigation');
  const pathname = usePathname();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('openMenu')}
          className="md:hidden"
        >
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="start" className="flex flex-col gap-6">
        <SheetHeader>
          <SheetTitle>{t('primary')}</SheetTitle>
          <SheetDescription className="sr-only">{t('openMenu')}</SheetDescription>
        </SheetHeader>
        {links.length === 0 ? (
          <p className="text-sm text-brand-textMuted">{t('empty')}</p>
        ) : (
          <nav className="flex flex-col gap-1">
            {links.map((link) => {
              const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    'relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150',
                    active
                      ? 'bg-brand-cyan/10 text-brand-navy'
                      : 'text-brand-textMuted hover:bg-brand-bg hover:text-brand-navy',
                  )}
                  aria-current={active ? 'page' : undefined}
                >
                  {active ? (
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-1.5 start-0 w-0.5 rounded-full bg-brand-cyan"
                    />
                  ) : null}
                  <span
                    className={cn(
                      'flex h-5 w-5 items-center justify-center',
                      active ? 'text-brand-blue' : 'text-brand-textMuted',
                    )}
                  >
                    {link.icon}
                  </span>
                  <span className="truncate">{link.label}</span>
                </Link>
              );
            })}
          </nav>
        )}
      </SheetContent>
    </Sheet>
  );
}
