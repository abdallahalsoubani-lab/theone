-- Prompt 43 (NI-6): notify the authoring therapist when a doctor edits a
-- home program (doctor edits auto-approve per P16 — the therapist previously
-- learned nothing).
ALTER TYPE "NotificationType" ADD VALUE 'HOME_PROGRAM_DOCTOR_EDITED';
