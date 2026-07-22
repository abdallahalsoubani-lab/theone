import type { UserRole } from '@prisma/client';

/**
 * Pure description of the staff sidebar per EFFECTIVE role (Prompt 22 §3.2).
 *
 * Extracted from the (staff) layout so a unit test can pin the invariant that
 * broke Act-As navigation: the sidebar must be built from the role the RBAC
 * gates will enforce — an impersonated DOCTOR must never be handed
 * /secretary/* links whose pages would throw ForbiddenError.
 *
 * `labelKey` is `<namespace>:<key>`; `badge` names the async counter the
 * layout wires up (secretary surfaces only). Icons stay in the layout (JSX).
 */
export interface StaffNavEntry {
  labelKey: `${'navigation' | 'patients'}:${string}`;
  href: string;
  icon:
    | 'calendar'
    | 'userCheck'
    | 'listChecks'
    | 'calendarX'
    | 'users'
    | 'userPlus'
    | 'inbox'
    | 'clipboardList'
    | 'clipboardCheck'
    | 'dumbbell';
  badge?: 'inbox' | 'waitlist' | 'intakeSubmissions';
}

export function staffNavEntries(role: UserRole): StaffNavEntry[] {
  if (role === 'SECRETARY' || role === 'ADMIN') {
    return [
      { labelKey: 'navigation:appointments', href: '/secretary/calendar', icon: 'calendar' },
      { labelKey: 'navigation:arrivals', href: '/secretary/arrivals', icon: 'userCheck' },
      {
        labelKey: 'navigation:waitlist',
        href: '/secretary/waitlist',
        icon: 'listChecks',
        badge: 'waitlist',
      },
      {
        labelKey: 'navigation:cancelled',
        href: '/secretary/appointments/cancelled',
        icon: 'calendarX',
      },
      { labelKey: 'patients:navTitle', href: '/secretary/patients', icon: 'users' },
      {
        labelKey: 'navigation:intakeSubmissions',
        href: '/secretary/intake-submissions',
        icon: 'userPlus',
        badge: 'intakeSubmissions',
      },
      { labelKey: 'navigation:inbox', href: '/secretary/inbox', icon: 'inbox', badge: 'inbox' },
    ];
  }
  if (role === 'DOCTOR') {
    return [
      { labelKey: 'navigation:appointments', href: '/doctor/dashboard', icon: 'calendar' },
      { labelKey: 'navigation:calendar', href: '/doctor/calendar', icon: 'calendar' },
      // Waitlist stays removed from the Doctor sidebar (QA retest #1): it
      // linked to the Secretary-only /secretary/waitlist route.
      {
        labelKey: 'navigation:cancelled',
        href: '/doctor/appointments/cancelled',
        icon: 'calendarX',
      },
      { labelKey: 'patients:navTitle', href: '/doctor/patients', icon: 'users' },
      { labelKey: 'navigation:treatmentPlans', href: '/doctor/plans', icon: 'clipboardList' },
      { labelKey: 'navigation:approvals', href: '/doctor/approvals', icon: 'clipboardCheck' },
      {
        labelKey: 'navigation:clinicianSummary',
        href: '/doctor/reports/clinicians',
        icon: 'clipboardList',
      },
      { labelKey: 'navigation:exerciseLibrary', href: '/clinical/exercises', icon: 'dumbbell' },
    ];
  }
  if (role === 'THERAPIST') {
    return [
      { labelKey: 'navigation:appointments', href: '/therapist/dashboard', icon: 'calendar' },
      { labelKey: 'navigation:calendar', href: '/therapist/calendar', icon: 'calendar' },
      { labelKey: 'patients:navTitle', href: '/therapist/patients', icon: 'users' },
      { labelKey: 'navigation:exerciseLibrary', href: '/clinical/exercises', icon: 'dumbbell' },
    ];
  }
  return [];
}
