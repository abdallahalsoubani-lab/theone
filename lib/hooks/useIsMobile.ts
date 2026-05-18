'use client';

import { useEffect, useState } from 'react';

/**
 * Tailwind-aligned mobile breakpoint hook. Returns true when the
 * viewport is below 768 px (`md:` breakpoint). SSR-safe — the
 * first render assumes desktop, the layout snaps after hydration.
 */
const MOBILE_BREAKPOINT_PX = 768;

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return isMobile;
}
