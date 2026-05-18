'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Responsive modal wrapper (Prompt 11 §4.7.2).
 *
 * Renders as a centered Dialog on desktop (≥ 768 px) and a bottom
 * sheet on mobile (< 768 px). Both layouts use the same Radix
 * Dialog primitive under the hood, so the API and accessibility
 * behaviour (focus trap, ESC, scroll lock, aria-* wiring) are
 * identical. The four Prompt 7b modal contents plus the side
 * panel swap their Dialog/Sheet roots for this wrapper without
 * touching their bodies.
 *
 * Breakpoint mirrors Tailwind's `md:` (768 px) so it matches the
 * rest of the design system. The detection is SSR-safe — the
 * initial render assumes desktop, and the layout snaps to mobile
 * after hydration when `matchMedia` is available.
 */

const MOBILE_BREAKPOINT_PX = 768;

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`);
    const handler = (e: MediaQueryListEvent | MediaQueryList) => setIsMobile(e.matches);
    handler(mq);
    mq.addEventListener('change', handler as (e: MediaQueryListEvent) => void);
    return () => mq.removeEventListener('change', handler as (e: MediaQueryListEvent) => void);
  }, []);
  return isMobile;
}

const ResponsiveModalContext = React.createContext<{ isMobile: boolean }>({
  isMobile: false,
});

export const ResponsiveModal = DialogPrimitive.Root;
export const ResponsiveModalTrigger = DialogPrimitive.Trigger;
export const ResponsiveModalClose = DialogPrimitive.Close;

const ResponsiveModalOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-brand-navy/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className,
    )}
    {...props}
  />
));
ResponsiveModalOverlay.displayName = 'ResponsiveModalOverlay';

export const ResponsiveModalContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /** Override the desktop max-width. Defaults to max-w-lg. */
    desktopMaxWidth?: string;
  }
>(({ className, children, desktopMaxWidth = 'max-w-lg', ...props }, ref) => {
  const isMobile = useIsMobile();
  return (
    <DialogPrimitive.Portal>
      <ResponsiveModalOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed z-50 flex flex-col gap-4 border border-brand-border bg-background shadow-lg outline-none',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          isMobile
            ? [
                'inset-x-0 bottom-0 max-h-[90vh] overflow-y-auto rounded-t-xl p-4 pb-6',
                'data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
              ]
            : [
                'start-1/2 top-1/2 w-full -translate-x-1/2 -translate-y-1/2 rounded-lg p-6',
                'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
                desktopMaxWidth,
              ],
          className,
        )}
        {...props}
      >
        {isMobile ? (
          // Swipe handle affordance — purely visual, the modal is dismissed
          // via the close button / ESC / overlay click like the desktop one.
          <div aria-hidden className="mx-auto mb-1 h-1.5 w-12 rounded-full bg-brand-border" />
        ) : null}
        <ResponsiveModalContext.Provider value={{ isMobile }}>
          {children}
        </ResponsiveModalContext.Provider>
        <DialogPrimitive.Close className="absolute end-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
ResponsiveModalContent.displayName = 'ResponsiveModalContent';

export const ResponsiveModalHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-col space-y-1.5 text-center sm:text-start', className)}
    {...props}
  />
);
ResponsiveModalHeader.displayName = 'ResponsiveModalHeader';

export const ResponsiveModalFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)}
    {...props}
  />
);
ResponsiveModalFooter.displayName = 'ResponsiveModalFooter';

export const ResponsiveModalTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold leading-none tracking-tight', className)}
    {...props}
  />
));
ResponsiveModalTitle.displayName = 'ResponsiveModalTitle';

export const ResponsiveModalDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-brand-textMuted', className)}
    {...props}
  />
));
ResponsiveModalDescription.displayName = 'ResponsiveModalDescription';
