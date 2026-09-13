'use client';

import { useEffect, useState } from 'react';

import { normalizePhoneForStorage } from '@/lib/format/phone';
import { sharedPhoneHoldersAction } from '@/lib/patients/actions';
import type { SharedPhoneHolder } from '@/lib/patients/shared-phone';

/**
 * P57 — debounced "who else holds this number" lookup for phone fields on
 * Secretary/Admin forms. Returns [] until the value is a complete Jordan
 * mobile; the server action is the privacy gate (Doctor/Therapist always
 * get []), so rendering the hint is safe wherever the phone field itself
 * renders.
 */
export function useSharedPhoneHolders(
  rawPhone: string | null | undefined,
  excludeId?: string | null,
): SharedPhoneHolder[] {
  const [holders, setHolders] = useState<SharedPhoneHolder[]>([]);
  // P61 — was Jordan-only, so the shared-number hint never fired for a
  // foreign number (and the secretary lost the duplicate warning entirely).
  const phone = rawPhone ? normalizePhoneForStorage(rawPhone) : null;

  useEffect(() => {
    if (!phone) {
      setHolders([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void sharedPhoneHoldersAction({ phone, excludeId: excludeId ?? null }).then((r) => {
        if (!cancelled) setHolders(r.ok ? r.data : []);
      });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [phone, excludeId]);

  return holders;
}
