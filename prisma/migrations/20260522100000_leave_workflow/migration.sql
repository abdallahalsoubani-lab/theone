-- Prompt 11 §4.1: leave-management workflow.
--
-- Adds the three leave-lifecycle NotificationType values, the
-- LEAVE_CONFLICT InboxItemType, and the InboxItem -> Leave FK so
-- the Secretary can navigate from a conflict alert back to the
-- approved leave that produced it.

ALTER TYPE "NotificationType" ADD VALUE 'LEAVE_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'LEAVE_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'LEAVE_REJECTED';

ALTER TYPE "InboxItemType" ADD VALUE 'LEAVE_CONFLICT';

ALTER TABLE "InboxItem" ADD COLUMN "leaveId" TEXT;

ALTER TABLE "InboxItem"
  ADD CONSTRAINT "InboxItem_leaveId_fkey"
  FOREIGN KEY ("leaveId") REFERENCES "Leave"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "InboxItem_leaveId_idx" ON "InboxItem"("leaveId");
