/**
 * Tier 1 — reference data.
 *
 * Idempotent. Safe to run on a populated database; every row is upserted by a
 * natural-key (unique name, unique template name, etc.) so re-running this seed
 * never duplicates and never destroys existing dev data.
 */

import {
  type PrismaClient,
  CustomQuestionAppliesTo,
  CustomQuestionType,
  LanguagePref,
  UserRole,
  WaTemplateApprovalStatus,
  WaTemplateCategory,
} from '@prisma/client';

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
      // Prompt 17: 24h reminder — wording no longer claims "30 minutes". Same
      // variable structure ({{1}} therapist, {{2}} time). The Meta-hosted
      // template text must be edited to match (see PR note).
      'Reminder: you have an appointment with {{1}} at {{2}}. Please arrive on time.',
      'تذكير: لديك موعد مع {{1}} الساعة {{2}}. نرجو الحضور في الوقت المحدد.',
      WaTemplateApprovalStatus.PENDING,
      true,
    ],
    [
      'appointment_rescheduled',
      WaTemplateCategory.APPOINTMENT,
      'Hi {{1}}, your appointment has been rescheduled to {{2}} at {{3}}. See you then.',
      'مرحباً {{1}}، تم تعديل موعدك إلى تاريخ {{2}} الساعة {{3}}. بانتظارك.',
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
    },
  ];
});

export async function seedReference(db: PrismaClient): Promise<void> {
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
        create: { ...t },
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
      defaultAppointmentDuration: 30,
      // Prompt 17: one reminder 24h before, clamped to 08:00–18:00 clinic-local.
      defaultReminderOffsetMinutes: 1440,
      reminderWindowStart: '08:00',
      reminderWindowEnd: '18:00',
      hijriDefault: false,
      defaultLanguage: LanguagePref.AR,
      businessHours: {
        sun: { open: '09:00', close: '18:00', closed: false },
        mon: { open: '09:00', close: '18:00', closed: false },
        tue: { open: '09:00', close: '18:00', closed: false },
        wed: { open: '09:00', close: '18:00', closed: false },
        thu: { open: '09:00', close: '18:00', closed: false },
        fri: { open: '09:00', close: '13:00', closed: true },
        sat: { open: '10:00', close: '14:00', closed: false },
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
