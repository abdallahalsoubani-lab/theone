-- PT-B4 item 3: a patient submitting the public intake form now notifies the
-- reception desk (SECRETARY + ADMIN). Until now the submission landed in the
-- queue silently — the sidebar count was the only signal, and that count was
-- itself frozen by App Router layout reuse.
ALTER TYPE "NotificationType" ADD VALUE 'INTAKE_SUBMISSION_RECEIVED';
