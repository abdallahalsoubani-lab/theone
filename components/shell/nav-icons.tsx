import {
  BarChart3,
  BriefcaseMedical,
  Calendar,
  CalendarDays,
  CalendarOff,
  CalendarX,
  ClipboardCheck,
  ClipboardList,
  DoorOpen,
  Dumbbell,
  HeartPulse,
  Inbox,
  ListChecks,
  MessageCircle,
  MessageSquare,
  ScrollText,
  Settings,
  Users,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import type { ReactNode } from 'react';

import type { AdminNavEntry } from './admin-nav';
import type { StaffNavEntry } from './staff-nav';

/**
 * One icon-token → JSX map shared by every surface that renders nav entries
 * (staff layout, admin layout, and the Header's mobile drawer — Prompt 46
 * item C). Tokens live in the pure nav configs so they stay unit-testable;
 * the JSX lives here exactly once.
 */
export const NAV_ICONS: Record<StaffNavEntry['icon'] | AdminNavEntry['icon'], ReactNode> = {
  calendar: <Calendar className="size-4" />,
  calendarDays: <CalendarDays className="size-4" />,
  calendarOff: <CalendarOff className="size-4" />,
  calendarX: <CalendarX className="size-4" />,
  userCheck: <UserCheck className="size-4" />,
  listChecks: <ListChecks className="size-4" />,
  users: <Users className="size-4" />,
  userPlus: <UserPlus className="size-4" />,
  inbox: <Inbox className="size-4" />,
  clipboardList: <ClipboardList className="size-4" />,
  clipboardCheck: <ClipboardCheck className="size-4" />,
  dumbbell: <Dumbbell className="size-4" />,
  messageCircle: <MessageCircle className="size-4" />,
  messageSquare: <MessageSquare className="size-4" />,
  barChart: <BarChart3 className="size-4" />,
  briefcaseMedical: <BriefcaseMedical className="size-4" />,
  doorOpen: <DoorOpen className="size-4" />,
  heartPulse: <HeartPulse className="size-4" />,
  scrollText: <ScrollText className="size-4" />,
  settings: <Settings className="size-4" />,
};
