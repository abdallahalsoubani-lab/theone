-- P64 #4 — per-pair read-only schedule access (viewer therapist → owner clinician).

-- CreateTable
CREATE TABLE "ScheduleViewGrant" (
    "id" TEXT NOT NULL,
    "viewerId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleViewGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduleViewGrant_ownerId_idx" ON "ScheduleViewGrant"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleViewGrant_viewerId_ownerId_key" ON "ScheduleViewGrant"("viewerId", "ownerId");

-- AddForeignKey
ALTER TABLE "ScheduleViewGrant" ADD CONSTRAINT "ScheduleViewGrant_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleViewGrant" ADD CONSTRAINT "ScheduleViewGrant_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
