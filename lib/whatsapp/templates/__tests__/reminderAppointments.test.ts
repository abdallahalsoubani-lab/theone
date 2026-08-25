import { describe, expect, it } from 'vitest';

import {
  formatReminderAppointments,
  reminderTime,
  type ReminderAppointment,
} from '../reminderAppointments';

/**
 * P53 — the same-day reminder body. Times are Asia/Amman (UTC+3), 12-hour,
 * Latin digits. 08:00Z = 11:00 AM Amman; 10:00Z = 1:00 PM Amman.
 */
const A = (id: string, iso: string, durationMinutes: number): ReminderAppointment => ({
  id,
  startsAt: new Date(iso),
  durationMinutes,
});

describe('reminderTime — Intl 12h Amman, Latin digits', () => {
  it('renders 10:00Z as 1:00 PM (en) and 1:00 م (ar)', () => {
    const t = new Date('2030-05-10T10:00:00Z');
    expect(reminderTime(t, 'en')).toMatch(/\b1:00\s?(PM|pm)\b/);
    expect(reminderTime(t, 'ar')).toContain('1:00');
    // Latin digits even in Arabic.
    expect(reminderTime(t, 'ar')).not.toMatch(/[٠-٩]/);
  });
});

describe('formatReminderAppointments — adjacency and spacing', () => {
  it('two adjacent (1:00–2:00, 2:00–3:00) → ONE range, no ordinals', () => {
    const out = formatReminderAppointments(
      [A('a', '2030-05-10T10:00:00Z', 60), A('b', '2030-05-10T11:00:00Z', 60)],
      'en',
    );
    expect(out).toMatch(/from 1:00\s?PM to 3:00\s?PM/i);
    expect(out).not.toContain('Appointment 1');
  });

  it('three adjacent in a chain → one range spanning all three', () => {
    const out = formatReminderAppointments(
      [
        A('a', '2030-05-10T10:00:00Z', 60), // 1:00–2:00
        A('b', '2030-05-10T11:00:00Z', 60), // 2:00–3:00
        A('c', '2030-05-10T12:00:00Z', 60), // 3:00–4:00
      ],
      'en',
    );
    expect(out).toMatch(/from 1:00\s?PM to 4:00\s?PM/i);
  });

  it('two spaced (1:00, 4:00) → two labelled entries, start-only, NO end times', () => {
    const out = formatReminderAppointments(
      [A('a', '2030-05-10T10:00:00Z', 60), A('b', '2030-05-10T13:00:00Z', 60)],
      'en',
    );
    expect(out).toMatch(/Appointment 1: at 1:00\s?PM/i);
    expect(out).toMatch(/Appointment 2: at 4:00\s?PM/i);
    // No end time for a standalone (2:00 PM / 5:00 PM must not appear).
    expect(out).not.toMatch(/2:00\s?PM/i);
    expect(out).not.toMatch(/5:00\s?PM/i);
  });

  it('mixed: adjacent pair (1:00–3:00) + later standalone (5:00) → range entry + time entry', () => {
    const out = formatReminderAppointments(
      [
        A('a', '2030-05-10T10:00:00Z', 60), // 1:00–2:00
        A('b', '2030-05-10T11:00:00Z', 60), // 2:00–3:00 (adjacent → run)
        A('c', '2030-05-10T14:00:00Z', 60), // 5:00 standalone
      ],
      'en',
    );
    expect(out).toMatch(/Appointment 1: from 1:00\s?PM to 3:00\s?PM/i);
    expect(out).toMatch(/Appointment 2: at 5:00\s?PM/i);
  });

  it('a 5-minute gap is NOT adjacency → two entries', () => {
    const out = formatReminderAppointments(
      [A('a', '2030-05-10T10:00:00Z', 60), A('b', '2030-05-10T11:05:00Z', 60)],
      'en',
    );
    expect(out).toContain('Appointment 1');
    expect(out).toContain('Appointment 2');
    expect(out).not.toMatch(/from .* to /i);
  });

  it('Arabic: adjacent pair → "من الساعة … حتى الساعة …"; spaced → "الموعد الأول/الثاني"', () => {
    const range = formatReminderAppointments(
      [A('a', '2030-05-10T10:00:00Z', 60), A('b', '2030-05-10T11:00:00Z', 60)],
      'ar',
    );
    expect(range).toContain('من الساعة');
    expect(range).toContain('حتى الساعة');
    expect(range).not.toContain('الموعد');

    const spaced = formatReminderAppointments(
      [A('a', '2030-05-10T10:00:00Z', 60), A('b', '2030-05-10T13:00:00Z', 60)],
      'ar',
    );
    expect(spaced).toContain('الموعد الأول');
    expect(spaced).toContain('الموعد الثاني');
  });

  it('input order does not matter (grouping sorts)', () => {
    const forward = formatReminderAppointments(
      [A('a', '2030-05-10T10:00:00Z', 60), A('b', '2030-05-10T11:00:00Z', 60)],
      'en',
    );
    const reversed = formatReminderAppointments(
      [A('b', '2030-05-10T11:00:00Z', 60), A('a', '2030-05-10T10:00:00Z', 60)],
      'en',
    );
    expect(forward).toBe(reversed);
  });
});
