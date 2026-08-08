-- PT-B2 item 1 — grandfather every home program that exists today.
--
-- Until now the clinician-facing surfaces (patient-file tab, patient-file PDF)
-- read the RAW HomeProgramItem rows, so an unapproved draft looked exactly
-- like the patient's real program. Those surfaces now read the approved
-- program only (getVisibleHomeProgram: live items when APPROVED, otherwise the
-- frozen approvedSnapshot).
--
-- That flip would blank the tab for any patient whose approval row is not
-- APPROVED and has no snapshot yet — content the clinic can see today. Owner
-- ruling: nothing existing may disappear on deploy. So we freeze the CURRENT
-- live items as the approved snapshot wherever one is missing, and we do not
-- touch any status (existing states are respected, per the same ruling).
--
-- Two cases are covered:
--   1. Patients with items but no approval row at all — create one APPROVED.
--      (Migration 20260612100000 covered everyone who had items then; this is
--      the defensive tail for anything created outside that path.)
--   2. Approval rows whose approvedSnapshot is NULL — including every row the
--      20260612100000 backfill created as APPROVED with a NULL snapshot, which
--      would otherwise blank the moment the program is reopened as a draft.
--
-- Idempotent: both statements are guarded on "no snapshot yet", so re-running
-- is a no-op. Safe to replay on any environment.

-- Case 1 — items exist, no approval row: grandfather as APPROVED.
INSERT INTO "HomeProgramApproval" ("patientId", "status", "remindersEnabled", "approvedAt", "updatedAt")
SELECT DISTINCT i."patientId", 'APPROVED'::"HomeProgramStatus", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "HomeProgramItem" i
WHERE NOT EXISTS (
  SELECT 1 FROM "HomeProgramApproval" a WHERE a."patientId" = i."patientId"
);

-- Case 2 — freeze today's items as the approved snapshot wherever it is NULL.
-- The JSON shape must match HomeProgramItemRow (lib/clinical/home-program/
-- queries.ts) because parseSnapshot reads it back directly; createdAt is an
-- ISO string, matching buildSnapshot.
UPDATE "HomeProgramApproval" a
SET "approvedSnapshot" = s.snapshot,
    "updatedAt" = CURRENT_TIMESTAMP
FROM (
  SELECT i."patientId",
         jsonb_agg(
           jsonb_build_object(
             'id', i."id",
             'patientId', i."patientId",
             'exerciseId', i."exerciseId",
             'exerciseNameEn', e."nameEn",
             'exerciseNameAr', e."nameAr",
             'exerciseVideoUrl', e."videoUrl",
             'exerciseImageUrl', e."imageUrl",
             'exerciseDescriptionEn', e."descriptionEn",
             'exerciseDescriptionAr', e."descriptionAr",
             'exerciseDefaultInstructionEn', e."defaultInstructionEn",
             'exerciseDefaultInstructionAr', e."defaultInstructionAr",
             'daysOfWeek', to_jsonb(i."daysOfWeek"),
             'scheduledTime', i."scheduledTime",
             'durationMinutes', i."durationMinutes",
             'setsReps', i."setsReps",
             'therapistNote', i."therapistNote",
             'active', i."active",
             'reminderJobKey', i."reminderJobKey",
             'createdAt', to_char(i."createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           )
           -- Same ordering as listHomeProgramForPatient.
           ORDER BY i."active" DESC, i."scheduledTime" ASC, i."createdAt" ASC
         ) AS snapshot
  FROM "HomeProgramItem" i
  JOIN "Exercise" e ON e."id" = i."exerciseId"
  GROUP BY i."patientId"
) s
WHERE s."patientId" = a."patientId"
  AND a."approvedSnapshot" IS NULL;
