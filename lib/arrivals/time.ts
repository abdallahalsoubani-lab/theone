/**
 * Clinic-local day boundaries for the arrivals system (Prompt 18).
 *
 * The implementations moved to lib/time/clinic.ts — the single clock-math
 * module (Prompt 31 §4.1). This file stays as a re-export so the arrivals
 * callers (kiosk, waitlist, dashboards) keep their historical import path.
 */

export { clinicDayRange, tzOffsetMs } from '@/lib/time/clinic';
