import { describe, expect, it } from 'vitest';

import { CALENDAR_SLOTS_PER_GROUP, CALENDAR_STEP_MINUTES } from '../slotConfig';

describe('calendar slot config (July 31 item 1)', () => {
  it('keeps the 15-minute interaction step — booking/drag/resize snap is behavior, not cosmetics', () => {
    expect(CALENDAR_STEP_MINUTES).toBe(15);
  });

  it('groups slots into whole hours so gridlines + axis labels are hour-only', () => {
    expect(CALENDAR_STEP_MINUTES * CALENDAR_SLOTS_PER_GROUP).toBe(60);
  });
});
