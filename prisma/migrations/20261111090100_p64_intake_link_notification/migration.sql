-- P64 #9 — notify staff when a patient completes their personal intake link.
ALTER TYPE "NotificationType" ADD VALUE 'INTAKE_LINK_COMPLETED';

-- P64 #10 — a therapist proposed the FIRST plan for a patient (doctor approves).
ALTER TYPE "NotificationType" ADD VALUE 'PLAN_INITIAL_PROPOSED';
