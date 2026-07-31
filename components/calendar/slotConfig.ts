/**
 * Time-grid granularity for the shared calendar (July 31 item 1).
 *
 * The two knobs are deliberately separate:
 *   - STEP is the interaction unit — slot selection, drag-reschedule snapping,
 *     and edge-resize all move in 15-minute increments. Changing it changes
 *     booking behavior; it is pinned by tests and must not drift.
 *   - SLOTS_PER_GROUP × STEP is the *visual* group: gridlines and axis labels
 *     render once per group. 4 × 15min = whole-hour groups, so the gutter
 *     shows 1, 2, 3 … with no half-hour line between them (clinic request).
 *     Purely cosmetic — :30 bookings and rendering are untouched.
 */
export const CALENDAR_STEP_MINUTES = 15;
export const CALENDAR_SLOTS_PER_GROUP = 4;
