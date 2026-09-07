import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * P60 — the reminder template selection lives in ONE place. Both the P17
 * worker and the manual panel import the builder; neither carries its own
 * copy of the single_v3 / multi / v2-fallback decision. A source sweep so a
 * future duplication fails CI, not production (the worker's day-grouping
 * tests pin the builder's output itself).
 */
const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8');

describe('reminder builder is shared by the worker and the manual send', () => {
  const worker = read('workers/reminder.ts');
  const manual = read('lib/whatsapp/manual/service.ts');
  const builder = read('lib/whatsapp/templates/reminderBuilder.ts');

  it('both sites import buildAppointmentReminderMessages from the builder', () => {
    for (const src of [worker, manual]) {
      expect(src).toContain("from '@/lib/whatsapp/templates/reminderBuilder'");
      expect(src).toContain('buildAppointmentReminderMessages');
      expect(src).toContain('loadReminderAppointment');
    }
  });

  it('template names + the v3 approval gate appear ONLY in the builder', () => {
    for (const name of [
      'appointment_reminder_single_v3',
      'appointment_reminder_multi',
      'appointment_reminder_v2',
      'reminderV3Approved',
    ]) {
      expect(builder).toContain(name);
      expect(worker).not.toContain(name);
      expect(manual, name).not.toContain(name);
    }
  });
});
