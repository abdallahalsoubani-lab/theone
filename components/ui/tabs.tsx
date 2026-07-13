'use client';

import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';

import { cn } from '@/lib/utils';

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & {
    /**
     * Multi-row layout for long tab sets (e.g. the 10-tab patient file):
     * real `flex` + `flex-wrap` + auto height instead of the default 40px
     * single inline row, so triggers flow onto extra rows instead of
     * overflowing/overlapping. Replaces the brittle `!flex` escape hatch
     * callers previously needed to beat the base `inline-flex`
     * (QA retest #10, Prompt-22 §7.5). `justify-start` is logical, so the
     * rows read correctly in both LTR and RTL.
     */
    wrap?: boolean;
  }
>(({ className, wrap = false, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'items-center rounded-lg border border-brand-border/60 bg-brand-bg p-1 text-brand-textMuted',
      wrap ? 'flex h-auto w-full flex-wrap justify-start gap-1' : 'inline-flex h-10 justify-center',
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'data-[state=active]:shadow-soft-xs inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ring-offset-background transition-all duration-150 hover:text-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-brand-surface data-[state=active]:text-brand-navy',
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'data-[state=active]:animate-fade-in mt-4 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
