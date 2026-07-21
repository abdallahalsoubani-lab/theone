-- CreateEnum
CREATE TYPE "AppointmentType" AS ENUM ('SESSION', 'STRETCHING', 'EVENT', 'GROUP', 'WORKSHOP');

-- AlterTable: booking-type discriminator; existing rows backfill to SESSION via the default.
ALTER TABLE "Appointment" ADD COLUMN "appointmentType" "AppointmentType" NOT NULL DEFAULT 'SESSION';

-- AlterTable: per-room simultaneous-stretching capacity (beds).
ALTER TABLE "Room" ADD COLUMN "bedCount" INTEGER NOT NULL DEFAULT 1;
