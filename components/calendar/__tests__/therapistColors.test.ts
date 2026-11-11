import { describe, expect, it } from 'vitest';

import {
  assignTherapistTints,
  NEUTRAL_TINT,
  resolveTint,
  THERAPIST_TINTS,
} from '../therapistColors';

describe('therapist colours (P64 #7)', () => {
  it('gives every clinician a distinct tint (up to the palette size)', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `cm${String(i).padStart(3, '0')}`);
    const map = assignTherapistTints(ids);
    const swatches = new Set([...map.values()].map((t) => t.swatch));
    expect(swatches.size).toBe(10);
    expect(THERAPIST_TINTS.length).toBeGreaterThanOrEqual(12);
  });

  it('is stable when a newer (higher cuid) clinician is added', () => {
    const before = assignTherapistTints(['ca1', 'cb2', 'cc3']);
    const after = assignTherapistTints(['ca1', 'cb2', 'cc3', 'cz9']);
    for (const id of ['ca1', 'cb2', 'cc3']) expect(after.get(id)).toBe(before.get(id));
  });

  it('ignores duplicates and input order', () => {
    const a = assignTherapistTints(['cb', 'ca', 'cb']);
    const b = assignTherapistTints(['ca', 'cb']);
    expect(a.get('ca')).toBe(b.get('ca'));
    expect(a.get('cb')).toBe(b.get('cb'));
  });

  it('paints synthetic lanes neutral', () => {
    const map = assignTherapistTints(['ca']);
    expect(resolveTint(map, '__stretching__', (x) => x.startsWith('__'))).toBe(NEUTRAL_TINT);
  });
});
