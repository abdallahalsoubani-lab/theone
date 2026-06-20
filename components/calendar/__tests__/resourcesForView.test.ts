import { describe, expect, it } from 'vitest';

import { resourcesForView } from '../resourcesForView';

const RESOURCES = [
  { resourceId: 't1', resourceTitle: 'Ahmad' },
  { resourceId: 't2', resourceTitle: 'Layan' },
];

describe('resourcesForView', () => {
  it('returns the resources in DAY view (therapist lanes)', () => {
    expect(resourcesForView('day', RESOURCES)).toBe(RESOURCES);
  });

  it('returns undefined in week/month/agenda (rbc clips resource columns there)', () => {
    expect(resourcesForView('week', RESOURCES)).toBeUndefined();
    expect(resourcesForView('month', RESOURCES)).toBeUndefined();
    expect(resourcesForView('agenda', RESOURCES)).toBeUndefined();
  });

  it('returns undefined when there are no resources, even in day view', () => {
    expect(resourcesForView('day', [])).toBeUndefined();
  });
});
