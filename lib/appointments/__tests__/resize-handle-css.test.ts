import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Prompt 46 §3 — the calendar resize handle rules live in CSS, so pin them
 * here the way link-targets pins routes: a refactor that drops either rule
 * fails loudly instead of silently regressing a drag behavior.
 *
 * E2E-verified 2026-07-23 (Playwright, secretary + admin, /en + /ar):
 *   - the dnd addon's bottom anchor measured ~3px tall and sat ~7px above
 *     the event's visible edge — realistic edge grabs landed on the MOVE
 *     surface and shifted the appointment (the clinic's complaint);
 *   - with the widened hit area the same grab resizes (audit
 *     APPOINTMENT_RESIZED, no dialog), and the top edge still MOVES
 *     (Prompt 34 rule, anchor hidden).
 */

const css = readFileSync(join(process.cwd(), 'components', 'calendar', 'calendar.css'), 'utf8');

describe('calendar resize handle CSS (P26/P34/P46 drag rules)', () => {
  it('keeps the TOP anchor hidden — top edge is MOVE, never resize (Prompt 34)', () => {
    const topRule = css.match(
      /\.rbc-addons-dnd-resizable > \.rbc-addons-dnd-resize-ns-anchor:first-child\s*\{[^}]*\}/,
    );
    expect(topRule?.[0]).toContain('display: none');
  });

  it('keeps the BOTTOM anchor hit area widened through the visible edge (Prompt 46)', () => {
    const bottomRule = css.match(
      /\.rbc-addons-dnd-resizable > \.rbc-addons-dnd-resize-ns-anchor:last-child\s*\{[^}]*\}/,
    );
    expect(bottomRule).not.toBeNull();
    const body = bottomRule![0];
    // ≥12px grab height, overhanging the wrapper inset, with the resize cursor.
    expect(body).toMatch(/height:\s*1[2-9]px/);
    expect(body).toMatch(/bottom:\s*-\d+px\s*!important/);
    expect(body).toContain('cursor: ns-resize');
  });
});
