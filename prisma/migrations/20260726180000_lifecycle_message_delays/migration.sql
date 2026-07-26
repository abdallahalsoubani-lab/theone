-- P53: admin-configurable delays for the booking-confirmation and
-- reschedule messages (coalescing). Default 0 = immediate (today's
-- behavior). Cancellation intentionally has NO delay column.
ALTER TABLE "ClinicSettings"
  ADD COLUMN "bookingConfirmationDelayMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "rescheduleMessageDelayMinutes" INTEGER NOT NULL DEFAULT 0;
