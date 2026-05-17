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
  metaTemplateName: string;
  language: LanguagePref;
  category: WaTemplateCategory;
  contentPreview: string;
};

// Stub previews — Meta-approved bodies arrive in Prompt 8. Each pair is EN + AR.
const WHATSAPP_TEMPLATES: ReadonlyArray<SeedTemplate> = [
  [
    'appointment_confirmation',
    WaTemplateCategory.APPOINTMENT,
    'Hi {{1}}, your appointment with {{2}} is confirmed for {{3}} at {{4}}.',
    'مرحباً {{1}}، تم تأكيد موعدك مع {{2}} يوم {{3}} الساعة {{4}}.',
  ],
  [
    'appointment_reminder_30min',
    WaTemplateCategory.APPOINTMENT,
    'Reminder: your appointment with {{1}} is in 30 minutes at {{2}}.',
    'تذكير: موعدك مع {{1}} بعد 30 دقيقة في {{2}}.',
  ],
  [
    'appointment_rescheduled',
    WaTemplateCategory.APPOINTMENT,
    'Your appointment has been moved to {{1}} at {{2}} with {{3}}.',
    'تم نقل موعدك إلى {{1}} الساعة {{2}} مع {{3}}.',
  ],
  [
    'appointment_cancelled',
    WaTemplateCategory.APPOINTMENT,
    'Your appointment on {{1}} at {{2}} has been cancelled. Reason: {{3}}.',
    'تم إلغاء موعدك بتاريخ {{1}} الساعة {{2}}. السبب: {{3}}.',
  ],
  [
    'home_exercise_reminder',
    WaTemplateCategory.HOME_PROGRAM,
    'Time for exercise "{{1}}". Therapist note: {{2}}. Watch: {{3}}.',
    'حان وقت تمرين «{{1}}». ملاحظة المعالج: {{2}}. شاهد الفيديو: {{3}}.',
  ],
  [
    'otp_login',
    WaTemplateCategory.OTP,
    'Your Theone.pt login code is {{1}}. It expires in 5 minutes.',
    'رمز الدخول إلى Theone.pt هو {{1}}. ينتهي خلال 5 دقائق.',
  ],
  [
    'patient_account_credentials',
    WaTemplateCategory.CREDENTIALS,
    'Welcome to Theone.pt. Login: {{1}}, temporary password: {{2}}. Please change it on first sign-in.',
    'مرحباً بك في Theone.pt. الدخول: {{1}}، كلمة مرور مؤقتة: {{2}}. يرجى تغييرها عند أول تسجيل دخول.',
  ],
].flatMap(([name, category, en, ar]) => [
  {
    metaTemplateName: name as string,
    language: LanguagePref.EN,
    category: category as WaTemplateCategory,
    contentPreview: en as string,
  },
  {
    metaTemplateName: `${name}_ar`,
    language: LanguagePref.AR,
    category: category as WaTemplateCategory,
    contentPreview: ar as string,
  },
]);

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
        where: { metaTemplateName: t.metaTemplateName },
        update: { contentPreview: t.contentPreview, language: t.language, category: t.category },
        create: t,
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
      defaultReminderOffsetMinutes: 30,
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
