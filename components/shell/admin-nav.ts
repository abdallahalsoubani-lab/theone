/**
 * Pure description of the Admin sidebar (Prompt 5 §4.4, grown since).
 *
 * Extracted from the (admin) layout in Prompt 46 item C so the Header's
 * mobile drawer can render the SAME entries the desktop sidebar shows —
 * the drawer used to receive a hard-coded empty list, which is exactly
 * the "sidebar shows nothing on phones" QA bug.
 *
 * `labelKey` is resolved under the `navigation.admin` namespace; icons are
 * tokens resolved through `components/shell/nav-icons.tsx`.
 */
export interface AdminNavEntry {
  labelKey: string;
  href: string;
  /** P48 — static count badge (computed by the layout at render). */
  badge?: 'waOutbox';
  icon:
    | 'calendarDays'
    | 'users'
    | 'heartPulse'
    | 'calendarOff'
    | 'briefcaseMedical'
    | 'doorOpen'
    | 'clipboardList'
    | 'messageSquare'
    | 'barChart'
    | 'send'
    | 'settings'
    | 'scrollText';
}

export function adminNavEntries(): AdminNavEntry[] {
  return [
    { labelKey: 'calendar', href: '/admin/calendar', icon: 'calendarDays' },
    { labelKey: 'users', href: '/admin/users', icon: 'users' },
    // Aug 1 (owner request): patient add/edit from the admin shell.
    { labelKey: 'patients', href: '/admin/patients', icon: 'heartPulse' },
    // Prompt 55 §1 — the leaves board got a proper sidebar entry.
    { labelKey: 'leaves', href: '/admin/leaves', icon: 'calendarOff' },
    { labelKey: 'specialties', href: '/admin/specialties', icon: 'briefcaseMedical' },
    { labelKey: 'rooms', href: '/admin/rooms', icon: 'doorOpen' },
    { labelKey: 'customQuestions', href: '/admin/intake-questions', icon: 'clipboardList' },
    { labelKey: 'whatsappTemplates', href: '/admin/whatsapp/templates', icon: 'messageSquare' },
    // P48 — the manual dispatch outbox; the badge is the total pending count.
    { labelKey: 'whatsappOutbox', href: '/admin/whatsapp/outbox', icon: 'send', badge: 'waOutbox' },
    { labelKey: 'whatsappMessages', href: '/admin/whatsapp/messages', icon: 'messageSquare' },
    { labelKey: 'reports', href: '/admin/reports/clinicians', icon: 'barChart' },
    { labelKey: 'settings', href: '/admin/settings', icon: 'settings' },
    { labelKey: 'audit', href: '/admin/audit', icon: 'scrollText' },
  ];
}
