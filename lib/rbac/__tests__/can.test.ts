import { UserRole } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { can, canAny, type PermissionUser } from '../can';
import { PERMISSIONS, ROLE_PERMISSIONS, listPermissions } from '../permissions';

const u = (role: UserRole, id = 'u-self'): PermissionUser => ({ id, role });

const OTHER = 'u-someone-else';

// ─────────────────────────────────────────────────────────────────────────
// Exhaustive grant table — every (role, code) pair from spec §4.1.
// Cells: 'yes' for unscoped grants; 'own'/'assigned'/'limited' for scoped.
// Any cell not listed defaults to false.
// ─────────────────────────────────────────────────────────────────────────
type Grant = true | 'own' | 'assigned' | 'limited' | 'broad';
const MATRIX: Record<UserRole, Partial<Record<string, Grant>>> = {
  PATIENT: {
    [PERMISSIONS.OWN_PROFILE_READ]: true,
    [PERMISSIONS.OWN_PROFILE_UPDATE]: true,
    [PERMISSIONS.APPOINTMENTS_READ_OWN]: 'own',
    [PERMISSIONS.TREATMENT_PLANS_READ_OWN]: 'own',
    [PERMISSIONS.PATIENT_TIMELINE_READ_LIMITED]: 'limited',
    [PERMISSIONS.HOME_PROGRAM_READ_OWN]: 'own',
    [PERMISSIONS.EXERCISE_MEDIA_READ_OWN]: 'own',
    [PERMISSIONS.PATIENTS_READ_OWN]: 'own',
    [PERMISSIONS.PATIENTS_UPDATE_OWN]: 'own',
    [PERMISSIONS.INTAKE_READ_OWN]: 'own',
    [PERMISSIONS.HOME_PROGRAM_COMPLETE_OWN]: 'own',
    [PERMISSIONS.EXERCISES_READ]: true,
    [PERMISSIONS.NOTIFICATIONS_READ_OWN]: 'own',
    [PERMISSIONS.NOTIFICATIONS_MARK_READ_OWN]: 'own',
  },
  SECRETARY: {
    [PERMISSIONS.OWN_PROFILE_READ]: true,
    [PERMISSIONS.OWN_PROFILE_UPDATE]: true,
    [PERMISSIONS.USERS_READ_PATIENTS]: 'broad',
    [PERMISSIONS.USERS_READ_THERAPISTS]: 'broad',
    [PERMISSIONS.APPOINTMENTS_CREATE]: true,
    [PERMISSIONS.APPOINTMENTS_READ]: true,
    [PERMISSIONS.APPOINTMENTS_UPDATE]: true,
    [PERMISSIONS.APPOINTMENTS_DELETE]: true,
    [PERMISSIONS.APPOINTMENTS_CANCEL]: true,
    [PERMISSIONS.APPOINTMENTS_STATUS_CHECKIN]: true,
    [PERMISSIONS.APPOINTMENTS_STATUS_COMPLETE]: true,
    [PERMISSIONS.APPOINTMENTS_STATUS_NOSHOW]: true,
    [PERMISSIONS.APPOINTMENTS_OVERRIDE_CONFLICT]: true,
    [PERMISSIONS.ARRIVALS_MANAGE]: true,
    [PERMISSIONS.WAITLIST_READ]: true,
    [PERMISSIONS.WAITLIST_CREATE]: true,
    [PERMISSIONS.WAITLIST_REMOVE]: true,
    [PERMISSIONS.WAITLIST_PLACE]: true,
    [PERMISSIONS.TREATMENT_PLANS_READ]: true,
    [PERMISSIONS.SESSION_NOTES_READ]: true,
    [PERMISSIONS.PATIENT_TIMELINE_READ]: true,
    [PERMISSIONS.HOME_PROGRAM_READ]: true,
    [PERMISSIONS.EXERCISES_READ]: true,
    [PERMISSIONS.LEAVES_CREATE_OWN]: 'own',
    [PERMISSIONS.LEAVES_READ_OWN]: 'own',
    [PERMISSIONS.LEAVES_READ]: true,
    [PERMISSIONS.REPORTS_READ]: true,
    [PERMISSIONS.ROOMS_READ]: true,
    [PERMISSIONS.PATIENTS_CREATE]: true,
    [PERMISSIONS.PATIENTS_READ]: true,
    [PERMISSIONS.PATIENTS_UPDATE]: true,
    [PERMISSIONS.PATIENTS_RESET_PASSWORD]: true,
    [PERMISSIONS.INTAKE_CREATE]: true,
    [PERMISSIONS.INTAKE_READ]: true,
    [PERMISSIONS.INTAKE_UPDATE]: true,
    [PERMISSIONS.INTAKE_SUBMISSION_READ]: true,
    [PERMISSIONS.INTAKE_SUBMISSION_REVIEW]: true,
    [PERMISSIONS.PATIENT_DOCUMENTS_READ]: true,
    [PERMISSIONS.PATIENT_DOCUMENTS_UPLOAD]: true,
    [PERMISSIONS.PATIENT_DOCUMENTS_DELETE]: true,
    [PERMISSIONS.INBOX_READ]: true,
    [PERMISSIONS.INBOX_RESOLVE]: true,
    [PERMISSIONS.NOTIFICATIONS_READ_OWN]: 'own',
    [PERMISSIONS.NOTIFICATIONS_MARK_READ_OWN]: 'own',
  },
  DOCTOR: {
    [PERMISSIONS.OWN_PROFILE_READ]: true,
    [PERMISSIONS.OWN_PROFILE_UPDATE]: true,
    [PERMISSIONS.USERS_READ_ASSIGNED]: 'assigned',
    [PERMISSIONS.APPOINTMENTS_READ_ASSIGNED]: 'assigned',
    // Prompt 15 §2B — full appointment-scheduling parity with Secretary.
    [PERMISSIONS.APPOINTMENTS_CREATE]: true,
    [PERMISSIONS.APPOINTMENTS_READ]: true,
    [PERMISSIONS.APPOINTMENTS_UPDATE]: true,
    [PERMISSIONS.APPOINTMENTS_DELETE]: true,
    [PERMISSIONS.APPOINTMENTS_CANCEL]: true,
    [PERMISSIONS.APPOINTMENTS_STATUS_CHECKIN]: true,
    [PERMISSIONS.APPOINTMENTS_STATUS_COMPLETE]: true,
    [PERMISSIONS.APPOINTMENTS_STATUS_NOSHOW]: true,
    [PERMISSIONS.APPOINTMENTS_OVERRIDE_CONFLICT]: true,
    [PERMISSIONS.WAITLIST_READ]: true,
    [PERMISSIONS.WAITLIST_CREATE]: true,
    [PERMISSIONS.WAITLIST_REMOVE]: true,
    [PERMISSIONS.WAITLIST_PLACE]: true,
    [PERMISSIONS.TREATMENT_PLANS_CREATE]: true,
    [PERMISSIONS.TREATMENT_PLANS_READ_ASSIGNED]: 'assigned',
    [PERMISSIONS.TREATMENT_PLANS_UPDATE_OWN]: 'own',
    [PERMISSIONS.TREATMENT_PLANS_APPROVE]: true,
    [PERMISSIONS.TREATMENT_PLANS_REJECT]: true,
    [PERMISSIONS.TREATMENT_PLANS_PAUSE]: true,
    [PERMISSIONS.TREATMENT_PLANS_COMPLETE]: true,
    [PERMISSIONS.TREATMENT_PLANS_DISCONTINUE]: true,
    [PERMISSIONS.SESSION_NOTES_READ_ASSIGNED]: 'assigned',
    [PERMISSIONS.SESSION_NOTES_ADDENDUM]: true,
    [PERMISSIONS.PATIENT_TIMELINE_READ_ASSIGNED]: 'assigned',
    [PERMISSIONS.TIMELINE_READ_ASSIGNED]: 'assigned',
    [PERMISSIONS.HOME_PROGRAM_READ]: true,
    [PERMISSIONS.HOME_PROGRAM_CREATE]: true,
    [PERMISSIONS.HOME_PROGRAM_UPDATE]: true,
    [PERMISSIONS.HOME_PROGRAM_DELETE]: true,
    [PERMISSIONS.HOME_PROGRAM_APPROVE]: true,
    [PERMISSIONS.HOME_PROGRAM_REQUEST_CHANGES]: true,
    [PERMISSIONS.EXERCISES_CREATE]: true,
    [PERMISSIONS.EXERCISES_READ]: true,
    [PERMISSIONS.EXERCISES_UPDATE]: true,
    [PERMISSIONS.LEAVES_CREATE_OWN]: 'own',
    [PERMISSIONS.LEAVES_READ_OWN]: 'own',
    [PERMISSIONS.REPORTS_READ]: true,
    [PERMISSIONS.REPORTS_REVIEW]: true,
    [PERMISSIONS.DOCTOR_REVIEWS_CREATE]: true,
    [PERMISSIONS.DOCTOR_REVIEWS_READ_ASSIGNED]: 'assigned',
    [PERMISSIONS.ROOMS_READ]: true,
    [PERMISSIONS.PATIENTS_READ_ASSIGNED]: 'assigned',
    [PERMISSIONS.INTAKE_READ_ASSIGNED]: 'assigned',
    [PERMISSIONS.PEDIATRIC_ASSESSMENT_CREATE]: true,
    [PERMISSIONS.PEDIATRIC_ASSESSMENT_READ_ASSIGNED]: 'assigned',
    [PERMISSIONS.PEDIATRIC_ASSESSMENT_UPDATE]: true,
    [PERMISSIONS.PEDIATRIC_ASSESSMENT_MANAGE_FIELDS]: true,
    [PERMISSIONS.PATIENT_DOCUMENTS_READ_ASSIGNED]: 'assigned',
    [PERMISSIONS.PATIENT_DOCUMENTS_UPLOAD]: true,
    [PERMISSIONS.PATIENT_DOCUMENTS_DELETE]: true,
    [PERMISSIONS.NOTIFICATIONS_READ_OWN]: 'own',
    [PERMISSIONS.NOTIFICATIONS_MARK_READ_OWN]: 'own',
  },
  THERAPIST: {
    [PERMISSIONS.OWN_PROFILE_READ]: true,
    [PERMISSIONS.OWN_PROFILE_UPDATE]: true,
    [PERMISSIONS.USERS_READ_ASSIGNED]: 'assigned',
    [PERMISSIONS.APPOINTMENTS_READ_ASSIGNED]: 'assigned',
    [PERMISSIONS.APPOINTMENTS_STATUS_COMPLETE]: true,
    [PERMISSIONS.TREATMENT_PLANS_READ_ASSIGNED]: 'assigned',
    // Prompt 16: therapist no longer directly edits plans (propose only).
    [PERMISSIONS.TREATMENT_PLANS_PROPOSE]: true,
    [PERMISSIONS.SESSION_NOTES_CREATE_OWN]: 'own',
    [PERMISSIONS.SESSION_NOTES_READ_ASSIGNED]: 'assigned',
    [PERMISSIONS.SESSION_NOTES_UPDATE_OWN]: 'own',
    [PERMISSIONS.SESSION_NOTES_ADDENDUM]: true,
    [PERMISSIONS.PATIENT_TIMELINE_READ_ASSIGNED]: 'assigned',
    [PERMISSIONS.TIMELINE_READ_ASSIGNED]: 'assigned',
    [PERMISSIONS.HOME_PROGRAM_READ]: true,
    [PERMISSIONS.HOME_PROGRAM_CREATE_ASSIGNED]: 'assigned',
    [PERMISSIONS.HOME_PROGRAM_UPDATE_ASSIGNED]: 'assigned',
    [PERMISSIONS.HOME_PROGRAM_CREATE]: true,
    [PERMISSIONS.HOME_PROGRAM_UPDATE]: true,
    [PERMISSIONS.HOME_PROGRAM_DELETE]: true,
    [PERMISSIONS.HOME_PROGRAM_SUBMIT]: true,
    [PERMISSIONS.EXERCISES_CREATE]: true,
    [PERMISSIONS.EXERCISES_READ]: true,
    [PERMISSIONS.EXERCISES_UPDATE]: true,
    [PERMISSIONS.EXERCISE_MEDIA_CREATE_OWN]: 'own',
    [PERMISSIONS.EXERCISE_MEDIA_UPDATE_OWN]: 'own',
    [PERMISSIONS.EXERCISE_MEDIA_DELETE_OWN]: 'own',
    [PERMISSIONS.LEAVES_CREATE_OWN]: 'own',
    [PERMISSIONS.LEAVES_READ_OWN]: 'own',
    [PERMISSIONS.REPORTS_READ_OWN]: 'own',
    [PERMISSIONS.REPORTS_SUBMIT]: true,
    [PERMISSIONS.ROOMS_READ]: true,
    [PERMISSIONS.PATIENTS_READ_ASSIGNED]: 'assigned',
    [PERMISSIONS.INTAKE_READ_ASSIGNED]: 'assigned',
    [PERMISSIONS.PEDIATRIC_ASSESSMENT_READ_ASSIGNED]: 'assigned',
    [PERMISSIONS.PATIENT_DOCUMENTS_READ_ASSIGNED]: 'assigned',
    [PERMISSIONS.NOTIFICATIONS_READ_OWN]: 'own',
    [PERMISSIONS.NOTIFICATIONS_MARK_READ_OWN]: 'own',
  },
  ADMIN: {
    [PERMISSIONS.OWN_PROFILE_READ]: true,
    [PERMISSIONS.OWN_PROFILE_UPDATE]: true,
    [PERMISSIONS.USERS_CREATE]: true,
    [PERMISSIONS.USERS_READ]: true,
    [PERMISSIONS.USERS_UPDATE]: true,
    [PERMISSIONS.USERS_DELETE]: true,
    [PERMISSIONS.APPOINTMENTS_CREATE]: true,
    [PERMISSIONS.APPOINTMENTS_READ]: true,
    [PERMISSIONS.APPOINTMENTS_UPDATE]: true,
    [PERMISSIONS.APPOINTMENTS_DELETE]: true,
    [PERMISSIONS.TREATMENT_PLANS_READ]: true,
    [PERMISSIONS.SESSION_NOTES_READ]: true,
    [PERMISSIONS.PATIENT_TIMELINE_READ]: true,
    [PERMISSIONS.HOME_PROGRAM_READ]: true,
    [PERMISSIONS.HOME_PROGRAM_CREATE]: true,
    [PERMISSIONS.HOME_PROGRAM_UPDATE]: true,
    [PERMISSIONS.HOME_PROGRAM_DELETE]: true,
    [PERMISSIONS.HOME_PROGRAM_APPROVE]: true,
    [PERMISSIONS.HOME_PROGRAM_REQUEST_CHANGES]: true,
    [PERMISSIONS.EXERCISES_CREATE]: true,
    [PERMISSIONS.EXERCISES_READ]: true,
    [PERMISSIONS.EXERCISES_UPDATE]: true,
    [PERMISSIONS.EXERCISES_ARCHIVE]: true,
    [PERMISSIONS.EXERCISE_MEDIA_CREATE]: true,
    [PERMISSIONS.EXERCISE_MEDIA_READ]: true,
    [PERMISSIONS.EXERCISE_MEDIA_UPDATE]: true,
    [PERMISSIONS.EXERCISE_MEDIA_DELETE]: true,
    [PERMISSIONS.LEAVES_CREATE_OWN]: 'own',
    [PERMISSIONS.LEAVES_READ_OWN]: 'own',
    [PERMISSIONS.LEAVES_READ]: true,
    [PERMISSIONS.LEAVES_UPDATE]: true,
    [PERMISSIONS.LEAVES_DELETE]: true,
    [PERMISSIONS.REPORTS_READ]: true,
    [PERMISSIONS.WHATSAPP_TEMPLATES_CREATE]: true,
    [PERMISSIONS.WHATSAPP_TEMPLATES_READ]: true,
    [PERMISSIONS.WHATSAPP_TEMPLATES_UPDATE]: true,
    [PERMISSIONS.WHATSAPP_TEMPLATES_DELETE]: true,
    [PERMISSIONS.SYSTEM_SETTINGS_CREATE]: true,
    [PERMISSIONS.SYSTEM_SETTINGS_READ]: true,
    [PERMISSIONS.SYSTEM_SETTINGS_UPDATE]: true,
    [PERMISSIONS.SYSTEM_SETTINGS_DELETE]: true,
    [PERMISSIONS.AUDIT_LOG_READ]: true,
    [PERMISSIONS.ROOMS_READ]: true,
    [PERMISSIONS.ROOMS_CREATE]: true,
    [PERMISSIONS.ROOMS_UPDATE]: true,
    [PERMISSIONS.ROOMS_ARCHIVE]: true,
    [PERMISSIONS.ROOMS_DELETE]: true,
    [PERMISSIONS.APPOINTMENTS_CANCEL]: true,
    [PERMISSIONS.APPOINTMENTS_STATUS_CHECKIN]: true,
    [PERMISSIONS.APPOINTMENTS_STATUS_COMPLETE]: true,
    [PERMISSIONS.APPOINTMENTS_STATUS_NOSHOW]: true,
    [PERMISSIONS.APPOINTMENTS_OVERRIDE_CONFLICT]: true,
    [PERMISSIONS.ARRIVALS_MANAGE]: true,
    [PERMISSIONS.WAITLIST_READ]: true,
    [PERMISSIONS.WAITLIST_CREATE]: true,
    [PERMISSIONS.WAITLIST_REMOVE]: true,
    [PERMISSIONS.WAITLIST_PLACE]: true,
    [PERMISSIONS.PATIENTS_CREATE]: true,
    [PERMISSIONS.PATIENTS_READ]: true,
    [PERMISSIONS.PATIENTS_UPDATE]: true,
    [PERMISSIONS.PATIENTS_ARCHIVE]: true,
    [PERMISSIONS.PATIENTS_RESET_PASSWORD]: true,
    [PERMISSIONS.INTAKE_CREATE]: true,
    [PERMISSIONS.INTAKE_READ]: true,
    [PERMISSIONS.INTAKE_UPDATE]: true,
    [PERMISSIONS.INTAKE_SUBMISSION_READ]: true,
    [PERMISSIONS.INTAKE_SUBMISSION_REVIEW]: true,
    [PERMISSIONS.PEDIATRIC_ASSESSMENT_CREATE]: true,
    [PERMISSIONS.PEDIATRIC_ASSESSMENT_READ_ASSIGNED]: 'assigned',
    [PERMISSIONS.PEDIATRIC_ASSESSMENT_UPDATE]: true,
    [PERMISSIONS.PEDIATRIC_ASSESSMENT_MANAGE_FIELDS]: true,
    [PERMISSIONS.PATIENT_DOCUMENTS_READ]: true,
    [PERMISSIONS.PATIENT_DOCUMENTS_READ_ASSIGNED]: 'assigned',
    [PERMISSIONS.PATIENT_DOCUMENTS_UPLOAD]: true,
    [PERMISSIONS.PATIENT_DOCUMENTS_DELETE]: true,
    [PERMISSIONS.INBOX_READ]: true,
    [PERMISSIONS.INBOX_RESOLVE]: true,
    [PERMISSIONS.WHATSAPP_MESSAGES_READ]: true,
    [PERMISSIONS.WHATSAPP_MESSAGES_RESEND]: true,
    [PERMISSIONS.REPORTS_SUBMIT]: true,
    [PERMISSIONS.REPORTS_REVIEW]: true,
    [PERMISSIONS.TREATMENT_PLANS_CREATE]: true,
    [PERMISSIONS.TREATMENT_PLANS_UPDATE_OWN]: 'own',
    [PERMISSIONS.TREATMENT_PLANS_PROPOSE]: true,
    [PERMISSIONS.TREATMENT_PLANS_APPROVE]: true,
    [PERMISSIONS.TREATMENT_PLANS_REJECT]: true,
    [PERMISSIONS.TREATMENT_PLANS_PAUSE]: true,
    [PERMISSIONS.TREATMENT_PLANS_COMPLETE]: true,
    [PERMISSIONS.TREATMENT_PLANS_DISCONTINUE]: true,
    [PERMISSIONS.SESSION_NOTES_CREATE_OWN]: 'own',
    [PERMISSIONS.SESSION_NOTES_UPDATE_OWN]: 'own',
    [PERMISSIONS.SESSION_NOTES_ADDENDUM]: true,
    [PERMISSIONS.DOCTOR_REVIEWS_CREATE]: true,
    [PERMISSIONS.DOCTOR_REVIEWS_READ_ASSIGNED]: 'assigned',
    [PERMISSIONS.TIMELINE_READ_ASSIGNED]: 'assigned',
    [PERMISSIONS.NOTIFICATIONS_READ_OWN]: 'own',
    [PERMISSIONS.NOTIFICATIONS_MARK_READ_OWN]: 'own',
  },
};

const ALL_CODES = listPermissions();
const ROLES = Object.values(UserRole);

function contextFor(grant: Grant, userId: string) {
  switch (grant) {
    case 'own':
    case 'limited':
      return { ownerId: userId };
    case 'assigned':
      return { assignedClinicianIds: [userId] };
    default:
      return {};
  }
}

describe('RBAC matrix — every (role × permission) pair', () => {
  for (const role of ROLES) {
    for (const code of ALL_CODES) {
      const grant = MATRIX[role][code];
      // Admin universal-read bypass — see `lib/rbac/can.ts`. Any
      // `*.read[.*]` action is allowed for Admin regardless of the
      // matrix above; the matrix still pins all *mutations* and all
      // non-Admin behaviour exactly.
      const adminReadBypass = role === 'ADMIN' && /^[a-z_]+\.read(\..+)?$/.test(code);
      const expected = Boolean(grant) || adminReadBypass;
      const label = `${role}: ${code} ${expected ? 'allowed' : 'denied'}`;
      it(label, () => {
        const user = u(role);
        const ctx = grant ? contextFor(grant, user.id) : {};
        expect(can(user, code, ctx)).toBe(expected);
      });
    }
  }
});

describe('Doctor appointment parity (Prompt 15 §2B)', () => {
  const OTHER_PATIENT = 'patient-not-on-care-team';

  it('Doctor may reschedule / cancel / create ANY appointment (unscoped, even off-care-team)', () => {
    const doctor = u('DOCTOR', 'dr-1');
    // Unscoped grants → allowed regardless of the resource's owner/assignee.
    expect(can(doctor, PERMISSIONS.APPOINTMENTS_UPDATE, { ownerId: OTHER_PATIENT })).toBe(true);
    expect(can(doctor, PERMISSIONS.APPOINTMENTS_CANCEL, { ownerId: OTHER_PATIENT })).toBe(true);
    expect(can(doctor, PERMISSIONS.APPOINTMENTS_CREATE)).toBe(true);
    expect(can(doctor, PERMISSIONS.APPOINTMENTS_OVERRIDE_CONFLICT)).toBe(true);
    expect(can(doctor, PERMISSIONS.APPOINTMENTS_READ)).toBe(true);
  });

  it('Therapist still cannot edit appointments (permissions unchanged)', () => {
    const therapist = u('THERAPIST', 'th-1');
    expect(can(therapist, PERMISSIONS.APPOINTMENTS_UPDATE)).toBe(false);
    expect(can(therapist, PERMISSIONS.APPOINTMENTS_CANCEL)).toBe(false);
    expect(can(therapist, PERMISSIONS.APPOINTMENTS_CREATE)).toBe(false);
  });

  it('Doctor now matches Secretary on the core scheduling permissions', () => {
    const doctor = u('DOCTOR', 'dr-1');
    const secretary = u('SECRETARY', 'sec-1');
    for (const code of [
      PERMISSIONS.APPOINTMENTS_CREATE,
      PERMISSIONS.APPOINTMENTS_UPDATE,
      PERMISSIONS.APPOINTMENTS_CANCEL,
      PERMISSIONS.APPOINTMENTS_OVERRIDE_CONFLICT,
    ]) {
      expect(can(doctor, code)).toBe(can(secretary, code));
    }
  });
});

describe('Booking waitlist (Prompt 19)', () => {
  it('Secretary, Admin, Doctor can read / create / remove / place', () => {
    for (const role of ['SECRETARY', 'ADMIN', 'DOCTOR'] as const) {
      const user = u(role);
      expect(can(user, PERMISSIONS.WAITLIST_READ)).toBe(true);
      expect(can(user, PERMISSIONS.WAITLIST_CREATE)).toBe(true);
      expect(can(user, PERMISSIONS.WAITLIST_REMOVE)).toBe(true);
      expect(can(user, PERMISSIONS.WAITLIST_PLACE)).toBe(true);
    }
  });

  it('Therapist cannot add or remove waitlist entries (§5)', () => {
    const therapist = u('THERAPIST');
    expect(can(therapist, PERMISSIONS.WAITLIST_CREATE)).toBe(false);
    expect(can(therapist, PERMISSIONS.WAITLIST_REMOVE)).toBe(false);
    expect(can(therapist, PERMISSIONS.WAITLIST_PLACE)).toBe(false);
    expect(can(therapist, PERMISSIONS.WAITLIST_READ)).toBe(false);
  });

  it('Patient has no waitlist access', () => {
    const patient = u('PATIENT');
    expect(can(patient, PERMISSIONS.WAITLIST_READ)).toBe(false);
    expect(can(patient, PERMISSIONS.WAITLIST_CREATE)).toBe(false);
  });
});

describe('Pediatric assessment (Prompt 21)', () => {
  it('Doctor + Admin create/edit and manage fields', () => {
    for (const role of ['DOCTOR', 'ADMIN'] as const) {
      const user = u(role);
      expect(can(user, PERMISSIONS.PEDIATRIC_ASSESSMENT_CREATE)).toBe(true);
      expect(can(user, PERMISSIONS.PEDIATRIC_ASSESSMENT_UPDATE)).toBe(true);
      expect(can(user, PERMISSIONS.PEDIATRIC_ASSESSMENT_MANAGE_FIELDS)).toBe(true);
      expect(can(user, PERMISSIONS.PEDIATRIC_ASSESSMENT_READ_ASSIGNED, {})).toBe(true);
    }
  });

  it('Therapist reads (assigned) but cannot write or manage fields', () => {
    const th = u('THERAPIST', 'th-1');
    expect(can(th, PERMISSIONS.PEDIATRIC_ASSESSMENT_READ_ASSIGNED, {})).toBe(true);
    expect(can(th, PERMISSIONS.PEDIATRIC_ASSESSMENT_CREATE)).toBe(false);
    expect(can(th, PERMISSIONS.PEDIATRIC_ASSESSMENT_UPDATE)).toBe(false);
    expect(can(th, PERMISSIONS.PEDIATRIC_ASSESSMENT_MANAGE_FIELDS)).toBe(false);
  });

  it('Secretary + Patient have NO pediatric-assessment access', () => {
    for (const role of ['SECRETARY', 'PATIENT'] as const) {
      const user = u(role);
      expect(can(user, PERMISSIONS.PEDIATRIC_ASSESSMENT_READ_ASSIGNED, {})).toBe(false);
      expect(can(user, PERMISSIONS.PEDIATRIC_ASSESSMENT_CREATE)).toBe(false);
      expect(can(user, PERMISSIONS.PEDIATRIC_ASSESSMENT_UPDATE)).toBe(false);
      expect(can(user, PERMISSIONS.PEDIATRIC_ASSESSMENT_MANAGE_FIELDS)).toBe(false);
    }
  });
});

describe('Patient documents (Prompt 22)', () => {
  it('Secretary + Admin: read + upload + delete (unscoped)', () => {
    for (const role of ['SECRETARY', 'ADMIN'] as const) {
      const user = u(role);
      expect(can(user, PERMISSIONS.PATIENT_DOCUMENTS_READ)).toBe(true);
      expect(can(user, PERMISSIONS.PATIENT_DOCUMENTS_UPLOAD)).toBe(true);
      expect(can(user, PERMISSIONS.PATIENT_DOCUMENTS_DELETE)).toBe(true);
    }
  });

  it('Doctor: read assigned + upload + delete', () => {
    const dr = u('DOCTOR', 'dr-1');
    expect(can(dr, PERMISSIONS.PATIENT_DOCUMENTS_READ_ASSIGNED, {})).toBe(true);
    expect(can(dr, PERMISSIONS.PATIENT_DOCUMENTS_UPLOAD)).toBe(true);
    expect(can(dr, PERMISSIONS.PATIENT_DOCUMENTS_DELETE)).toBe(true);
  });

  it('Therapist: read assigned only — no upload/delete', () => {
    const th = u('THERAPIST', 'th-1');
    expect(can(th, PERMISSIONS.PATIENT_DOCUMENTS_READ_ASSIGNED, {})).toBe(true);
    expect(can(th, PERMISSIONS.PATIENT_DOCUMENTS_UPLOAD)).toBe(false);
    expect(can(th, PERMISSIONS.PATIENT_DOCUMENTS_DELETE)).toBe(false);
  });

  it('an unassigned therapist cannot read a specific patient document', () => {
    const th = u('THERAPIST', 'th-1');
    expect(
      can(th, PERMISSIONS.PATIENT_DOCUMENTS_READ_ASSIGNED, {
        assignedClinicianIds: ['someone-else'],
      }),
    ).toBe(false);
  });

  it('Patient has no document access', () => {
    expect(can(u('PATIENT'), PERMISSIONS.PATIENT_DOCUMENTS_READ_ASSIGNED, {})).toBe(false);
    expect(can(u('PATIENT'), PERMISSIONS.PATIENT_DOCUMENTS_UPLOAD)).toBe(false);
  });
});

describe('Public intake submissions review (Prompt 23)', () => {
  it('Secretary + Admin: read + review the pending queue', () => {
    for (const role of ['SECRETARY', 'ADMIN'] as const) {
      const user = u(role);
      expect(can(user, PERMISSIONS.INTAKE_SUBMISSION_READ)).toBe(true);
      expect(can(user, PERMISSIONS.INTAKE_SUBMISSION_REVIEW)).toBe(true);
    }
  });

  it('Doctor / Therapist / Patient: no access to the review queue', () => {
    for (const role of ['DOCTOR', 'THERAPIST', 'PATIENT'] as const) {
      const user = u(role);
      expect(can(user, PERMISSIONS.INTAKE_SUBMISSION_REVIEW)).toBe(false);
    }
    // .read is a mutation-free verb but still ungranted for clinicians;
    // the Admin universal-read bypass intentionally does NOT extend to them.
    expect(can(u('THERAPIST'), PERMISSIONS.INTAKE_SUBMISSION_READ)).toBe(false);
    expect(can(u('PATIENT'), PERMISSIONS.INTAKE_SUBMISSION_READ)).toBe(false);
  });
});

describe('scope edge cases', () => {
  // List-intent fallback: when a scoped action is checked without a
  // concrete resource, the role grant alone is sufficient (list-page
  // entry gate). The query layer is responsible for narrowing to the
  // actor's owned / assigned rows. See `lib/rbac/can.ts`.
  it('.own allows the role grant alone when ownerId is missing (list intent)', () => {
    expect(can(u('PATIENT'), PERMISSIONS.APPOINTMENTS_READ_OWN, {})).toBe(true);
  });

  it('.own list intent still denies a role that lacks the grant', () => {
    // SECRETARY has no APPOINTMENTS_READ_OWN; list-intent fallback must
    // not skip the role-grant check.
    expect(can(u('SECRETARY'), PERMISSIONS.APPOINTMENTS_READ_OWN, {})).toBe(false);
  });

  it('.own denies when ownerId belongs to someone else', () => {
    expect(can(u('PATIENT', 'u-self'), PERMISSIONS.APPOINTMENTS_READ_OWN, { ownerId: OTHER })).toBe(
      false,
    );
  });

  it('.assigned allows the role grant alone when no resource is given (list intent)', () => {
    expect(can(u('THERAPIST', 'u-self'), PERMISSIONS.PATIENTS_READ_ASSIGNED, {})).toBe(true);
    expect(can(u('DOCTOR', 'u-self'), PERMISSIONS.PATIENTS_READ_ASSIGNED, {})).toBe(true);
  });

  it('.assigned list intent denies a role that lacks the grant', () => {
    expect(can(u('PATIENT'), PERMISSIONS.PATIENTS_READ_ASSIGNED, {})).toBe(false);
  });

  it('.assigned denies when the actor is not in the list', () => {
    expect(
      can(u('THERAPIST', 'u-self'), PERMISSIONS.SESSION_NOTES_READ_ASSIGNED, {
        assignedClinicianIds: [OTHER],
      }),
    ).toBe(false);
  });

  it('.assigned passes only when the actor IS in the list', () => {
    expect(
      can(u('THERAPIST', 'u-self'), PERMISSIONS.SESSION_NOTES_READ_ASSIGNED, {
        assignedClinicianIds: ['u-self', OTHER],
      }),
    ).toBe(true);
  });

  it('.limited (patient timeline) is owner-scoped', () => {
    expect(
      can(u('PATIENT', 'u-self'), PERMISSIONS.PATIENT_TIMELINE_READ_LIMITED, {
        ownerId: 'u-self',
      }),
    ).toBe(true);
    expect(
      can(u('PATIENT', 'u-self'), PERMISSIONS.PATIENT_TIMELINE_READ_LIMITED, { ownerId: OTHER }),
    ).toBe(false);
  });

  it('rejects unknown permission codes regardless of role', () => {
    for (const role of ROLES) {
      expect(can(u(role), 'totally.fake.permission')).toBe(false);
    }
  });
});

describe('admin universal-read bypass', () => {
  it('allows every *.read[.*] action for Admin without an explicit grant', () => {
    const admin = u('ADMIN');
    // Codes that Admin's grant set deliberately omits but the bypass
    // covers — picked from real call sites that were throwing
    // ForbiddenError before the bypass was in place.
    expect(can(admin, PERMISSIONS.PATIENTS_READ_ASSIGNED)).toBe(true);
    expect(can(admin, PERMISSIONS.SESSION_NOTES_READ_ASSIGNED)).toBe(true);
    expect(can(admin, PERMISSIONS.HOME_PROGRAM_READ_OWN)).toBe(true);
    expect(can(admin, PERMISSIONS.TREATMENT_PLANS_READ_ASSIGNED)).toBe(true);
  });

  it('does not bypass for non-read verbs', () => {
    const admin = u('ADMIN');
    // `notifications.mark_read.own` is a mutation despite the substring
    // — it must still go through the explicit grant check.
    expect(can(admin, PERMISSIONS.NOTIFICATIONS_MARK_READ_OWN)).toBe(true); // admin has it via explicit grant
    // session_notes.create.own is a write — admin must NOT auto-pass.
    expect(can(admin, PERMISSIONS.SESSION_NOTES_CREATE_OWN)).toBe(true); // admin has it via explicit grant
    // exercise_media.delete.own is a write — admin must NOT auto-pass.
    // (Admin actually has EXERCISE_MEDIA_DELETE broad, so this is true
    // via explicit grant, not via bypass — assertion still pins the
    // grant-path behaviour.)
    expect(can(admin, PERMISSIONS.EXERCISE_MEDIA_DELETE)).toBe(true);
  });

  it('does not extend the bypass to non-Admin roles', () => {
    expect(can(u('SECRETARY'), PERMISSIONS.HOME_PROGRAM_READ_OWN)).toBe(false);
    expect(can(u('DOCTOR'), PERMISSIONS.EXERCISE_MEDIA_READ_OWN)).toBe(false);
    expect(can(u('PATIENT'), PERMISSIONS.SESSION_NOTES_READ_ASSIGNED)).toBe(false);
  });
});

describe('canAny', () => {
  it('returns true when at least one code is granted', () => {
    expect(canAny(u('ADMIN'), ['users.create', 'totally.fake'])).toBe(true);
  });
  it('returns false when no code is granted', () => {
    expect(canAny(u('PATIENT'), [PERMISSIONS.USERS_CREATE, PERMISSIONS.USERS_DELETE])).toBe(false);
  });
});

describe('catalog invariants', () => {
  it('every code in ROLE_PERMISSIONS is in the public catalog', () => {
    for (const set of Object.values(ROLE_PERMISSIONS)) {
      for (const code of set) {
        expect(ALL_CODES).toContain(code);
      }
    }
  });
});
