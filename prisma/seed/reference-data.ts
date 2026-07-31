/**
 * Tier 1 — reference data.
 *
 * Idempotent. Safe to run on a populated database; every row is upserted by a
 * natural-key (unique name, unique template name, etc.) so re-running this seed
 * never duplicates and never destroys existing dev data.
 */

import {
  type Prisma,
  type PrismaClient,
  CustomQuestionAppliesTo,
  CustomQuestionType,
  LanguagePref,
  UserRole,
  WaTemplateApprovalStatus,
  WaTemplateCategory,
} from '@prisma/client';

// Relative import (not '@/...'): the seed runs under bare tsx, which does not
// resolve tsconfig path aliases. `lib/system/actor` is dependency-free.
import { SYSTEM_USER } from '../../lib/system/actor';

const SPECIALTIES: ReadonlyArray<{ nameEn: string; nameAr: string }> = [
  { nameEn: 'Orthopedic Physiotherapy', nameAr: 'علاج طبيعي عظمي' },
  { nameEn: 'Sports Rehabilitation', nameAr: 'إعادة تأهيل رياضي' },
  { nameEn: 'Pediatric Physiotherapy', nameAr: 'علاج طبيعي للأطفال' },
  { nameEn: 'Neurological Physiotherapy', nameAr: 'علاج طبيعي عصبي' },
  { nameEn: 'Geriatric Physiotherapy', nameAr: 'علاج طبيعي لكبار السن' },
  { nameEn: 'Cardiopulmonary Physiotherapy', nameAr: 'علاج طبيعي قلبي تنفسي' },
  { nameEn: 'Manual Therapy', nameAr: 'علاج يدوي' },
];

const ROOMS: ReadonlyArray<string> = [
  'Treatment Room 1',
  'Treatment Room 2',
  'Treatment Room 3',
  'Pediatric Room',
  'Gym',
];

type SeedTemplate = {
  name: string;
  language: LanguagePref;
  category: WaTemplateCategory;
  contentPreview: string;
  metaTemplateName: string;
  metaApprovalStatus: WaTemplateApprovalStatus;
  active: boolean;
  twilioContentSid: string | null;
  twilioApproved: boolean;
  variablesShape: string[] | null;
};

/**
 * Reference templates. The `name` column is the canonical logical identifier
 * (e.g., `appointment_reminder_v2`) that call sites reference via
 * `whatsapp.sendTemplate({ name, language, … })`. `metaTemplateName` is the
 * exact template name registered in Meta WhatsApp Manager (kept identical to
 * the logical name on purpose). `contentPreview` mirrors the **real** body
 * registered in Meta and — critically — the placeholder count must match the
 * arguments the call site passes (see the inventory in
 * `docs/whatsapp/templates.md`).
 *
 * Provider state is deliberately NOT overwritten on re-seed (see the upsert
 * below): `metaApprovalStatus`, `active`, `twilioContentSid`, and
 * `twilioApproved` are only set on first create. This keeps a later manual
 * APPROVED flip (and any real Twilio ContentSid) from being clobbered by
 * `pnpm db:seed`.
 *
 * Per-template state seeded on create:
 *   - The five active Meta templates start PENDING (in review) + active.
 *   - `patient_account_credentials` is REJECTED by Meta and deferred to phase
 *     two → seeded inactive (the send path skips when inactive).
 *   - `otp_login` is not yet created in Meta and deferred → seeded inactive
 *     (the WhatsApp OTP sender falls back to console when inactive).
 *
 * Twilio is the dormant backup provider; no dev ContentSid placeholders are
 * seeded anymore (they were the old `HX_DEV_*` values). Real Twilio SIDs, if
 * ever added by hand, survive re-seeds untouched.
 */
type SeedTemplateSource = [
  name: string,
  category: WaTemplateCategory,
  en: string,
  ar: string,
  metaApprovalStatus: WaTemplateApprovalStatus,
  active: boolean,
];

// Prompt 48b — explicit legacy variable shapes seeded on create so the
// registry is self-describing from day one. The v2 switch updates the row's
// shape (+ SID) from Admin → WhatsApp → Templates with zero deploy:
// v2 shape for the four appointment templates = ["patientName","dayName","date","time"].
const SEED_SHAPES: Record<string, string[] | null> = {
  appointment_confirmation_v2: ['patientName', 'therapistName', 'date', 'time'],
  // P54: the approved v2 pack (buttons + day-name) is the live set — a
  // fresh DB seeds the 4-var shape; the production switch itself runs via
  // scripts/switch-templates-v2.ts (audited, SID-verified).
  appointment_reminder_v2: ['patientName', 'dayName', 'date', 'time'],
  appointment_rescheduled: ['patientName', 'dayName', 'date', 'time'],
  appointment_cancelled_v2: ['date', 'time', 'reason'],
  // July 31 item 3: {{1}} = patient first name.
  arrival_confirmation: ['patientName'],
  home_exercise_reminder_v2: null,
  otp_login: null,
  patient_account_credentials: null,
};

const WHATSAPP_TEMPLATES: ReadonlyArray<SeedTemplate> = (
  [
    [
      'appointment_confirmation_v2',
      WaTemplateCategory.APPOINTMENT,
      'Hi {{1}}, your appointment with {{2}} on {{3}} at {{4}} is confirmed. See you soon.',
      'مرحباً {{1}}، تم تأكيد موعدك مع {{2}} بتاريخ {{3}} الساعة {{4}}. نراك قريباً.',
      WaTemplateApprovalStatus.PENDING,
      true,
    ],
    [
      'appointment_reminder_v2',
      WaTemplateCategory.APPOINTMENT,
      // P54: the APPROVED v2 quick-reply body (buttons confirm/decline) —
      // {{1}} patient, {{2}} day name, {{3}} date, {{4}} time.
      'Hello {{1}}, this is a reminder of your appointment on {{2}}, {{3}} at {{4}}.\nPlease confirm by tapping an option below. To change or cancel, let us know at least 24 hours in advance.\nIf we receive no reply, the appointment will be cancelled.',
      'مرحباً {{1}}، نذكّركم بموعدكم يوم {{2}} الموافق {{3}} الساعة {{4}}.\nيرجى تأكيد الحضور بالضغط على أحد الخيارين أدناه، وفي حال الرغبة بتعديل أو إلغاء الموعد نرجو إبلاغنا قبل 24 ساعة.\nفي حال عدم الرد سيتم إلغاء الموعد.',
      WaTemplateApprovalStatus.PENDING,
      true,
    ],
    [
      'appointment_rescheduled',
      WaTemplateCategory.APPOINTMENT,
      // P54: the APPROVED v2 body — same 4-var day-name shape.
      'Hi {{1}}, your appointment has been moved to {{2}}, {{3}} at {{4}}. See you then.',
      'مرحباً {{1}}، تم تغيير موعدكم إلى يوم {{2}} الموافق {{3}} الساعة {{4}}. نراكم قريباً.',
      WaTemplateApprovalStatus.PENDING,
      true,
    ],
    [
      'appointment_cancelled_v2',
      WaTemplateCategory.APPOINTMENT,
      'Your appointment on {{1}} at {{2}} was cancelled. Reason: {{3}}. You can rebook anytime.',
      'نأسف، تم إلغاء موعدك بتاريخ {{1}} الساعة {{2}}. السبب: {{3}}. يمكنك حجز موعد جديد في أي وقت.',
      WaTemplateApprovalStatus.PENDING,
      true,
    ],
    [
      'arrival_confirmation',
      WaTemplateCategory.APPOINTMENT,
      // July 31 item 3 — sent once per arrival group on every check-in
      // commit (kiosk + secretary). Twilio-only: production SIDs are applied
      // by scripts/add-arrival-templates.ts; Meta never had this template.
      'Hi {{1}}, your arrival at The One Physiotherapy Center has been registered. We wish you a great session.',
      'أهلاً {{1}}، تم تسجيل وصولك في المركز الأول للعلاج الطبيعي. نتمنى لك جلسة موفقة.',
      WaTemplateApprovalStatus.NOT_SUBMITTED,
      true,
    ],
    [
      'home_exercise_reminder_v2',
      WaTemplateCategory.HOME_PROGRAM,
      'Time for your exercise "{{1}}". Therapist note: {{2}}. Watch the video here: {{3}} and keep it up.',
      'حان وقت تمرينك «{{1}}». ملاحظة المعالج: {{2}}. شاهد الفيديو عبر الرابط: {{3}} وواصل تمارينك.',
      WaTemplateApprovalStatus.PENDING,
      true,
    ],
    [
      'otp_login',
      WaTemplateCategory.OTP,
      'Your Theone.pt login code is {{1}} and expires in 5 minutes. Do not share it.',
      'رمز الدخول إلى Theone.pt هو {{1}} وينتهي خلال 5 دقائق. لا تشاركه مع أحد.',
      WaTemplateApprovalStatus.NOT_SUBMITTED,
      false,
    ],
    [
      'patient_account_credentials',
      WaTemplateCategory.CREDENTIALS,
      'Welcome to Theone.pt. Your username is {{1}} and temporary password is {{2}}. Please change it on first sign-in.',
      'مرحباً بك في Theone.pt. اسم المستخدم: {{1}} وكلمة المرور المؤقتة: {{2}}. يرجى تغييرها عند أول تسجيل دخول.',
      WaTemplateApprovalStatus.REJECTED,
      false,
    ],
  ] satisfies ReadonlyArray<SeedTemplateSource>
).flatMap(([name, category, en, ar, metaApprovalStatus, active]): SeedTemplate[] => {
  return [
    {
      name,
      language: LanguagePref.EN,
      category,
      contentPreview: en,
      metaTemplateName: name,
      metaApprovalStatus,
      active,
      twilioContentSid: null,
      twilioApproved: false,
      variablesShape: SEED_SHAPES[name] ?? null,
    },
    {
      name,
      language: LanguagePref.AR,
      category,
      contentPreview: ar,
      metaTemplateName: name,
      metaApprovalStatus,
      active,
      twilioContentSid: null,
      twilioApproved: false,
      variablesShape: SEED_SHAPES[name] ?? null,
    },
  ];
});

export async function seedReference(db: PrismaClient): Promise<void> {
  // Reserved "system" user — the audit actor for background-worker mutations
  // (Fix Prompt 2: overdue-session auto-complete). Fixed id, reserved email,
  // no password hash → can never log in. See lib/system/actor.ts.
  await db.user.upsert({
    where: { id: SYSTEM_USER.id },
    update: { fullNameEn: SYSTEM_USER.fullNameEn, fullNameAr: SYSTEM_USER.fullNameAr },
    create: {
      id: SYSTEM_USER.id,
      email: SYSTEM_USER.email,
      phone: SYSTEM_USER.phone,
      role: UserRole.ADMIN,
      fullNameEn: SYSTEM_USER.fullNameEn,
      fullNameAr: SYSTEM_USER.fullNameAr,
    },
  });

  await Promise.all(
    SPECIALTIES.map((s) =>
      db.specialty.upsert({
        where: { nameEn: s.nameEn },
        update: { nameAr: s.nameAr, active: true },
        create: { ...s, active: true },
      }),
    ),
  );

  // Rooms have no natural unique key in the schema, so guard idempotency by name.
  for (const name of ROOMS) {
    const existing = await db.room.findFirst({ where: { name } });
    if (!existing) await db.room.create({ data: { name } });
  }

  await Promise.all(
    WHATSAPP_TEMPLATES.map((t) =>
      db.whatsAppTemplate.upsert({
        where: { name_language: { name: t.name, language: t.language } },
        // On re-seed we refresh only the content-preview / category / Meta
        // template name. Provider *state* — metaApprovalStatus, active, the
        // Twilio ContentSid, and twilioApproved — is intentionally left
        // untouched so a manual APPROVED flip / activation toggle (post Meta
        // review) and any real Twilio SID survive `pnpm db:seed`.
        update: {
          contentPreview: t.contentPreview,
          category: t.category,
          metaTemplateName: t.metaTemplateName,
        },
        create: {
          ...t,
          // Json column: null means "omit" at create (Prisma nullable-Json
          // rules); arrays pass through as InputJsonValue.
          variablesShape:
            t.variablesShape === null
              ? undefined
              : (t.variablesShape as unknown as Prisma.InputJsonValue),
        },
      }),
    ),
  );

  // ClinicSettings singleton — Prompt 5 §4.3. Sensible defaults aligned with
  // a Jordan clinic (Sun-Thu open, Fri closed, Sat open; Asia/Amman; AR default).
  await db.clinicSettings.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      nameEn: 'The One for Physiotherapy',
      nameAr: 'المركز الأول للعلاج الطبيعي',
      phone: '+962790000000',
      addressEn: 'Amman, Jordan',
      addressAr: 'عمّان، الأردن',
      timezone: 'Asia/Amman',
      defaultAppointmentDuration: 60,
      // Prompt 17: one reminder 24h before, clamped to 08:00–18:00 clinic-local.
      defaultReminderOffsetMinutes: 1440,
      reminderWindowStart: '08:00',
      reminderWindowEnd: '18:00',
      // Fix Prompt 2: Start-Session gate + overdue auto-complete grace (minutes).
      sessionStartGraceMinutes: 15,
      sessionAutoCompleteGraceMinutes: 15,
      // Prompt 18: manual "your turn in ~X minutes" for the kiosk. Tokens are
      // left null — admin generates them from clinic settings when ready.
      currentDelayMinutes: 10,
      hijriDefault: false,
      defaultLanguage: LanguagePref.AR,
      businessHours: {
        sun: { open: '09:00', close: '18:00', closed: false },
        mon: { open: '09:00', close: '18:00', closed: false },
        tue: { open: '09:00', close: '18:00', closed: false },
        wed: { open: '09:00', close: '18:00', closed: false },
        thu: { open: '09:00', close: '18:00', closed: false },
        // Friday + Saturday are non-working days (Prompt 22 §4.2). Seeds
        // never re-run in production — the live ClinicSettings row is
        // flipped via the admin settings UI / deploy data step.
        fri: { open: '09:00', close: '13:00', closed: true },
        sat: { open: '10:00', close: '14:00', closed: true },
      },
      serviceTypes: [
        {
          id: 'initial',
          nameEn: 'Initial assessment',
          nameAr: 'تقييم أوّلي',
          defaultDurationMinutes: 45,
        },
        {
          id: 'followup',
          nameEn: 'Follow-up session',
          nameAr: 'جلسة متابعة',
          defaultDurationMinutes: 30,
        },
        {
          id: 'sports',
          nameEn: 'Sports rehab session',
          nameAr: 'جلسة تأهيل رياضي',
          defaultDurationMinutes: 45,
        },
      ],
    },
  });

  // Custom intake questions are seeded by seedCustomQuestions() once a User with
  // ADMIN role exists. Calling it here would fail FK on a fresh DB.
}

/**
 * Seeded once an Admin exists. Idempotent — re-runs upsert existing rows.
 * Called from the main runner after Tier 2 has created the Admin user.
 */
export async function seedCustomQuestions(db: PrismaClient): Promise<void> {
  const admin = await db.user.findFirst({ where: { role: UserRole.ADMIN } });
  if (!admin) {
    console.warn('[seed] no Admin user — skipping custom intake questions');
    return;
  }

  await db.intakeCustomQuestion.upsert({
    where: { id: 'seed-q-sports-practiced' },
    update: { createdById: admin.id },
    create: {
      id: 'seed-q-sports-practiced',
      nameEn: 'Sports practiced',
      nameAr: 'الرياضات الممارسة',
      type: CustomQuestionType.MULTI_SELECT,
      options: [
        { valueEn: 'Football', valueAr: 'كرة القدم' },
        { valueEn: 'Running', valueAr: 'الجري' },
        { valueEn: 'Swimming', valueAr: 'السباحة' },
        { valueEn: 'Weightlifting', valueAr: 'رفع الأثقال' },
        { valueEn: 'Cycling', valueAr: 'ركوب الدراجة' },
      ],
      appliesTo: CustomQuestionAppliesTo.ADULT,
      required: false,
      displayOrder: 1,
      active: true,
      createdById: admin.id,
    },
  });

  await db.intakeCustomQuestion.upsert({
    where: { id: 'seed-q-birth-development' },
    update: { createdById: admin.id },
    create: {
      id: 'seed-q-birth-development',
      nameEn: 'Notes about birth and early development',
      nameAr: 'ملاحظات حول الولادة والنمو المبكر',
      type: CustomQuestionType.TEXTAREA,
      options: undefined,
      appliesTo: CustomQuestionAppliesTo.PEDIATRIC,
      required: false,
      displayOrder: 1,
      active: true,
      createdById: admin.id,
    },
  });
}
