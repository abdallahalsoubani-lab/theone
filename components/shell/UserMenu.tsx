'use client';

import { LogIn, LogOut, User as UserIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Link } from '@/i18n/navigation';
import { logoutAction } from '@/lib/auth/actions/logout';

interface UserMenuProps {
  user: null | {
    fullNameEn: string;
    fullNameAr: string;
    role: string;
  };
}

/**
 * Authenticated user menu in the header. Renders a "Sign in" CTA for
 * unauthenticated visitors and an avatar + dropdown for signed-in users.
 *
 * The display name flips to the Arabic full name under the `ar` locale so
 * the avatar initials match the visible name and the screen-reader name is
 * not jarring for Arabic-speaking users.
 */
export function UserMenu({ user }: UserMenuProps) {
  const t = useTranslations('shell');
  const tAuth = useTranslations('auth');
  const locale = useLocale();

  if (!user) {
    return (
      <Button asChild variant="default" size="sm">
        <Link href="/login">
          <LogIn className="me-2 size-4" />
          {tAuth('signIn')}
        </Link>
      </Button>
    );
  }

  const displayName = locale === 'ar' ? user.fullNameAr : user.fullNameEn;
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('userMenu')}
          className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Avatar>
            <AvatarFallback>{initials || <UserIcon className="size-4" />}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="space-y-1">
          <div className="font-medium text-brand-navy">{displayName}</div>
          <Badge variant="cyan" className="text-[10px]">
            {user.role}
          </Badge>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/profile">{t('profile')}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">{t('userMenu')}</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            void logoutAction();
          }}
        >
          <LogOut className="me-2 size-4" />
          {tAuth('signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
