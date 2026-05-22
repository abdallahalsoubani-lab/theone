import * as React from 'react';

import { cn } from '@/lib/utils';

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-10 w-full rounded-md border border-brand-border bg-background px-3 py-2 text-base text-brand-text ring-offset-background transition-[border-color,box-shadow] duration-150 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-brand-textMuted/70 hover:border-brand-textMuted/40 focus-visible:border-brand-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/30 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:bg-brand-bg disabled:opacity-60 md:text-sm',
          'aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:border-destructive aria-[invalid=true]:focus-visible:ring-destructive/25',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
