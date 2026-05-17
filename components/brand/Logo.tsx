import Image from 'next/image';

import { cn } from '@/lib/utils';

type LogoVariant = 'icon' | 'wordmark';
type LogoTheme = 'light' | 'dark';

interface LogoProps {
  /** `icon` (default) renders the square mark. `wordmark` renders the horizontal lockup. */
  variant?: LogoVariant;
  /** `light` (default) suits white/cream backgrounds. `dark` suits navy/photo backgrounds. */
  theme?: LogoTheme;
  /**
   * Pixel size for the icon variant (the wordmark variant scales width-first and ignores this).
   * Defaults to 40 — small enough for header bars, large enough for legible text inside.
   */
  size?: number;
  className?: string;
}

const ICON_SOURCES: Record<LogoTheme, string> = {
  light: '/logo.svg',
  dark: '/logo-dark.svg',
};

export function Logo({ variant = 'icon', theme = 'light', size = 40, className }: LogoProps) {
  if (variant === 'wordmark') {
    const width = Math.max(size * 3, 160);
    const height = Math.round(width / 4);
    return (
      <Image
        src="/logo-wordmark.svg"
        alt="Theone.pt"
        width={width}
        height={height}
        priority
        className={cn('select-none', className)}
      />
    );
  }

  return (
    <Image
      src={ICON_SOURCES[theme]}
      alt="Theone.pt"
      width={size}
      height={size}
      priority
      className={cn('select-none', className)}
    />
  );
}
