import { NotificationType } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { NOTIFICATION_TEMPLATES } from '../templates';

describe('NOTIFICATION_TEMPLATES', () => {
  it('covers every NotificationType in the Prisma enum', () => {
    for (const type of Object.values(NotificationType)) {
      expect(NOTIFICATION_TEMPLATES[type]).toBeDefined();
      expect(NOTIFICATION_TEMPLATES[type].titleKey).toContain(type);
      expect(NOTIFICATION_TEMPLATES[type].bodyKey).toContain(type);
    }
  });

  it('includes the Prompt 7b therapist-change types separately (assigned + removed)', () => {
    expect(NOTIFICATION_TEMPLATES.APPOINTMENT_THERAPIST_ASSIGNED).toBeDefined();
    expect(NOTIFICATION_TEMPLATES.APPOINTMENT_THERAPIST_REMOVED).toBeDefined();
    expect(NOTIFICATION_TEMPLATES.APPOINTMENT_THERAPIST_ASSIGNED.titleKey).not.toEqual(
      NOTIFICATION_TEMPLATES.APPOINTMENT_THERAPIST_REMOVED.titleKey,
    );
  });
});
