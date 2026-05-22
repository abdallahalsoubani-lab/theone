import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium leading-5 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive:
          'border-transparent bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/20',
        outline: 'border-brand-border text-brand-navy',
        teal: 'border-transparent bg-brand-teal/10 text-brand-teal ring-1 ring-inset ring-brand-teal/25',
        cyan: 'border-transparent bg-brand-cyan/15 text-brand-blue ring-1 ring-inset ring-brand-cyan/30',
        muted:
          'border-transparent bg-brand-bg text-brand-textMuted ring-1 ring-inset ring-brand-border',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
