import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every static notification linkPath must land on a real route (Prompt 33 —
 * the therapist "assigned/removed" notifications pointed at
 * `/therapist/schedule`, which never existed, since Prompt 7b). The list below
 * mirrors the literal linkPaths in lib/** — when adding a notification with a
 * new static link, add it here so a renamed/removed page fails loudly.
 */

const STATIC_LINK_PATHS = [
  '/admin/leaves',
  '/doctor/approvals',
  '/doctor/reports/weekly',
  '/secretary/calendar',
  '/secretary/waitlist',
  '/staff/leave',
  '/therapist/dashboard',
  '/therapist/calendar', // fixed target of the old dead /therapist/schedule
];

/** Dynamic linkPath prefixes → the [param] route directory that serves them. */
const DYNAMIC_LINK_ROUTES = [
  { example: '/doctor/plans/:id', dir: '(staff)/doctor/plans/[id]' },
  { example: '/therapist/plans/:id', dir: '(staff)/therapist/plans/[id]' },
  { example: '/secretary/patients/:id', dir: '(staff)/secretary/patients/[id]' },
  { example: '/therapist/patients/:id', dir: '(staff)/therapist/patients/[id]' },
  {
    example: '/therapist/patients/:id/home-program/edit',
    dir: '(staff)/therapist/patients/[id]/home-program/edit',
  },
  {
    example: '/therapist/sessions/notes/:id/edit',
    dir: '(staff)/therapist/sessions/notes/[id]/edit',
  },
  // A-19: the calendar side panel's role-aware profile links.
  { example: '/admin/patients/:id', dir: '(admin)/admin/patients/[id]' },
  { example: '/doctor/patients/:id', dir: '(staff)/doctor/patients/[id]' },
];

const APP_DIR = join(process.cwd(), 'app', '[locale]');

function pageExists(relDir: string): boolean {
  return existsSync(join(APP_DIR, relDir, 'page.tsx'));
}

/** Static paths live under either the (staff) or (admin) route group. */
function staticPageExists(linkPath: string): boolean {
  const rel = linkPath.replace(/^\//, '');
  return pageExists(join('(staff)', rel)) || pageExists(join('(admin)', rel));
}

describe('notification link targets resolve to real routes', () => {
  it.each(STATIC_LINK_PATHS)('%s has a page', (linkPath) => {
    expect(staticPageExists(linkPath), `no page for ${linkPath}`).toBe(true);
  });

  it.each(DYNAMIC_LINK_ROUTES)('$example has a page', ({ example, dir }) => {
    expect(pageExists(dir), `no page for ${example} (${dir})`).toBe(true);
  });

  it('the dead /therapist/schedule linkPath is gone from the codebase target list', () => {
    expect(staticPageExists('/therapist/schedule')).toBe(false);
  });
});
