import { describe, expect, it } from 'vitest';

import { therapistAppointmentHref } from '../links';

describe('therapistAppointmentHref (dashboard card destination)', () => {
  it('deep-links to the session note when one exists', () => {
    expect(therapistAppointmentHref({ patientId: 'p1', sessionNoteId: 'note-9' })).toBe(
      '/therapist/sessions/notes/note-9/edit',
    );
  });

  it('falls back to the patient file when there is no session note yet', () => {
    expect(therapistAppointmentHref({ patientId: 'p1', sessionNoteId: null })).toBe(
      '/therapist/patients/p1',
    );
    expect(therapistAppointmentHref({ patientId: 'p1' })).toBe('/therapist/patients/p1');
  });
});
