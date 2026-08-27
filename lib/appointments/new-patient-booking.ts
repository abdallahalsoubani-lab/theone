import { AppointmentStatus, AuditAction, UserRole } from '@prisma/client';
import type { Gender, IntakeType } from '@prisma/client';

import { auth } from '@/auth';
import { withAudit } from '@/lib/audit/withAudit';
import { hashPassword } from '@/lib/auth/password';
import { generateTempPassword } from '@/lib/admin/temp-password';
import { db } from '@/lib/db';
import { normalizeJordanPhone } from '@/lib/format/phone';
import { patientDisplayName } from '@/lib/format/patientName';
import { findSharedPhoneHolders, sharedPhoneHolderNames } from '@/lib/patients/shared-phone';
import { addCareTeamMemberTx } from '@/lib/patients/assignment';
import { recordDispatchEvent } from '@/lib/whatsapp/dispatch/service';

import { checkConflicts, hasHardBlockedConflict, type Conflict } from './conflicts';
import { generateIntakeToken } from '@/lib/intake-links/tokens';
import type { NewPatientBookingInput } from './schemas';
import { getReminderConfig, resyncPatientDayReminders } from './services';
import { isStartInPast } from './session-timing';
import { PLACEHOLDER_DOB } from '@/lib/patients/placeholder-dob';

export class NewPatientBookingError extends Error {
  constructor(
    public readonly error: {
      code: string;
      message_en: string;
      message_ar: string;
      details?: Record<string, unknown>;
    },
  ) {
    super(error.message_en);
    this.name = 'NewPatientBookingError';
  }
}

export interface NewPatientBookingResult {
  patientId: string;
  appointmentId: string;
  intakeToken: string;
  conflictsOverridden: boolean;
}

/**
 * Create a brand-new patient, their single-use personal intake link, and the
 * appointment — ATOMICALLY (owner requirement: a booking never leaves an
 * orphan patient, a failed patient-create never half-books). Everything the
 * standard single booking does (conflict engine, care-team auto-add,
 * reminder, the P48/P51 confirmation dispatch) applies unchanged; only the
 * patient + link creation is added, inside the same transaction.
 *
 * Duplicate phone — P57 (clinic-approved REVERSAL of P52 owner decision 5):
 * the hard block (PATIENT_PHONE_EXISTS / PATIENT_PHONE_AMBIGUOUS) is gone.
 * A parent legitimately books several children on one number. The P50 §5.3
 * pattern applies instead: an unconfirmed submit against a number other
 * active patients hold fails with PATIENT_PHONE_SHARED_CONFIRM naming them
 * (details carry the holders so the modal can still offer "use this
 * patient"); resubmitting with `confirmSharedPhone` creates the record.
 * One extra click, never a block.
 *
 * No portal credentials are sent here (unlike the full patient-create): the
 * new patient receives exactly ONE message — the combined confirmation +
 * intake link (owner decision 6). Credentials can be issued later from the
 * patient file if the clinic sets up portal access.
 */
export const createNewPatientBooking = withAudit<[NewPatientBookingInput], NewPatientBookingResult>(
  {
    entityType: 'User',
    action: AuditAction.CREATE,
    extractEntityId: (_args, result) => result.patientId,
    extractAfter: (result) => ({
      event: 'NEW_PATIENT_BOOKING_CREATED',
      patientId: result.patientId,
      appointmentId: result.appointmentId,
    }),
  },
  async function createNewPatientBookingInner(
    input: NewPatientBookingInput,
  ): Promise<NewPatientBookingResult> {
    const session = await auth();
    if (!session?.user?.id) {
      throw new NewPatientBookingError({
        code: 'UNAUTHENTICATED',
        message_en: 'Sign-in required.',
        message_ar: 'يلزم تسجيل الدخول.',
      });
    }
    const actorId = session.user.id;

    if (isStartInPast(input.startsAt)) {
      throw new NewPatientBookingError({
        code: 'APPOINTMENT_IN_PAST',
        message_en: 'The appointment starts in the past.',
        message_ar: 'الموعد يبدأ في وقت مضى.',
      });
    }

    // Normalize the phone (Jordan mobile canonical; fall back to the trimmed
    // input for a non-Jordan number the general E.164 create allows). One
    // normalizer — the same the auth/kiosk paths use.
    const normalizedPhone = normalizeJordanPhone(input.phone) ?? input.phone.trim();

    // Shared-number confirm FIRST (P57) — the secretary sees who already
    // holds the number before anything is created; confirmed → proceed.
    if (!input.confirmSharedPhone) {
      const holders = await findSharedPhoneHolders(normalizedPhone);
      if (holders.length > 0) {
        const names = sharedPhoneHolderNames(holders);
        throw new NewPatientBookingError({
          code: 'PATIENT_PHONE_SHARED_CONFIRM',
          message_en: `This number is already registered to ${names}. Save anyway?`,
          message_ar: `هذا الرقم مسجّل مسبقاً باسم ${names}. هل تريد الحفظ رغم ذلك؟`,
          details: {
            holders: holders.map((h) => ({
              id: h.id,
              name: patientDisplayName(h.fullNameEn, h.fullNameAr),
            })),
          },
        });
      }
    }

    // Conflict engine BEFORE the transaction (same order as createAppointment).
    const conflicts = await checkConflicts({
      patientId: null,
      therapistIds: input.therapistIds,
      startsAt: input.startsAt,
      durationMinutes: input.durationMinutes,
      appointmentType: input.appointmentType,
      roomId: input.roomId,
    });
    if (!conflicts.ok) {
      if (hasHardBlockedConflict(conflicts.conflicts)) {
        throw new NewPatientBookingError({
          code: 'APPOINTMENT_HARD_CONFLICT',
          message_en: 'This slot conflicts and cannot be booked.',
          message_ar: 'هذا الموعد يتعارض ولا يمكن حجزه.',
          details: { conflicts: conflicts.conflicts as unknown as Conflict[] },
        });
      }
      if (!input.overrideConflicts) {
        throw new NewPatientBookingError({
          code: 'APPOINTMENT_CONFLICT',
          message_en: 'This slot conflicts — override or pick another time.',
          message_ar: 'هذا الموعد يتعارض — تجاوز التعارض أو اختر وقتاً آخر.',
          details: { conflicts: conflicts.conflicts as unknown as Conflict[] },
        });
      }
    }

    const therapistIds = [...new Set(input.therapistIds)];
    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);
    const token = generateIntakeToken();

    const result = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          role: UserRole.PATIENT,
          fullNameEn: input.fullNameEn,
          // P47 row 8 — English-name only; the NOT NULL column stores ''.
          fullNameAr: '',
          phone: normalizedPhone,
          // Default AR (clinic language); the intake link lets the patient
          // set their own preference along with the rest of their profile.
          languagePref: 'AR',
          passwordHash,
          mustChangePassword: true,
        },
      });
      await tx.patientProfile.create({
        data: {
          userId: user.id,
          // Unknown until the patient fills the intake link (decision 1).
          dateOfBirth: PLACEHOLDER_DOB,
          gender: null as Gender | null,
        },
      });
      const appt = await tx.appointment.create({
        data: {
          patientId: user.id,
          appointmentType: input.appointmentType,
          roomId: input.roomId,
          startsAt: input.startsAt,
          durationMinutes: input.durationMinutes,
          status: AppointmentStatus.SCHEDULED,
          notes: input.notes ?? null,
          createdById: actorId,
          therapists: { create: therapistIds.map((therapistId) => ({ therapistId })) },
        },
      });
      for (const therapistId of therapistIds) {
        await addCareTeamMemberTx(tx, user.id, therapistId, actorId);
      }
      await tx.patientIntakeLink.create({
        data: {
          patientId: user.id,
          token,
          formType: input.formType,
          createdById: actorId,
          appointmentId: appt.id,
        },
      });
      return { patientId: user.id, appointmentId: appt.id };
    });

    // Reminder + confirmation dispatch AFTER commit — identical to a normal
    // booking. The confirmation sender detects the unused intake link and
    // sends the combined new-patient template instead of the standard one;
    // its P48/P51 hold + silent-mode behavior is inherited unchanged.
    const config = await getReminderConfig();
    // P53 — one reminder per patient per clinic-day (the new patient may have
    // no other same-day booking, but route through the same path uniformly).
    await resyncPatientDayReminders({
      patientId: result.patientId,
      instants: [input.startsAt],
      config,
    }).catch((err: unknown) => {
      console.error('[new-patient-booking] reminder resync failed', err);
    });
    await recordDispatchEvent({
      appointmentId: result.appointmentId,
      patientId: result.patientId,
      startsAt: input.startsAt,
      type: 'BOOKING_CONFIRMATION',
    }).catch((err: unknown) => {
      console.error('[new-patient-booking] dispatch record failed', err);
    });

    return {
      patientId: result.patientId,
      appointmentId: result.appointmentId,
      intakeToken: token,
      conflictsOverridden: !conflicts.ok && input.overrideConflicts,
    };
  },
);

export type { IntakeType };
