# Twilio WhatsApp Content Templates — paste-ready package (Prompt 45)

**For:** Twilio Console → **Messaging → Content Template Builder → Create new**
**WABA:** `1645151657192049` (fresh — no templates exist yet) · Sender: `+962780150215`

**Submitted 2026-07-23: the 10 UTILITY entries (sections 1–5 × ar/en).**
Sections 6 (`otp_login`) and 7 (`patient_account_credentials`) are DEFERRED by
owner decision — their template rows stay `active=false` in the app, so the
health check does NOT count them (they can be submitted + activated any time
later). Each entry below gives you the exact values for the builder form. Content type is **Text** for every template.
After Meta approval, each template gets a **Content SID (HX…)** — paste those
into the app per `docs/whatsapp-twilio.md` §3.

> Variable syntax is `{{1}} {{2}} …` exactly as written — the app fills them in
> this order. The "sample values" column is for Twilio's required sample fields
> during submission (use them as-is; they're realistic, not real patients).

---

## 1a · appointment_confirmation_ar — Category: **UTILITY** — Language: **ar**

```
مرحباً {{1}}، تم تأكيد موعدك مع {{2}} بتاريخ {{3}} الساعة {{4}}. نراك قريباً.
```

| Var   | Meaning              | Sample value |
| ----- | -------------------- | ------------ |
| {{1}} | اسم المريض           | سارة خليل    |
| {{2}} | اسم المعالج/الدكتورة | د. سارة      |
| {{3}} | التاريخ              | 2026-08-01   |
| {{4}} | الوقت                | 16:30        |

## 1b · appointment_confirmation_en — Category: **UTILITY** — Language: **en**

```
Hi {{1}}, your appointment with {{2}} on {{3}} at {{4}} is confirmed. See you soon.
```

| Var   | Meaning        | Sample value |
| ----- | -------------- | ------------ |
| {{1}} | Patient name   | Sara Khalil  |
| {{2}} | Clinician name | Dr. Sara     |
| {{3}} | Date           | 2026-08-01   |
| {{4}} | Time           | 16:30        |

---

## 2a · appointment_reminder_ar — Category: **UTILITY** — Language: **ar**

```
تذكير: لديك موعد يوم {{3}} الساعة {{2}} مع {{1}}. نرجو الحضور في الوقت المحدد.
```

| Var   | Meaning              | Sample value |
| ----- | -------------------- | ------------ |
| {{1}} | اسم المعالج/الدكتورة | د. سارة      |
| {{2}} | الوقت                | 16:30        |
| {{3}} | اليوم/التاريخ        | 2026-08-01   |

## 2b · appointment_reminder_en — Category: **UTILITY** — Language: **en**

```
Reminder: you have an appointment on {{3}} at {{2}} with {{1}}. Please arrive on time.
```

| Var   | Meaning        | Sample value |
| ----- | -------------- | ------------ |
| {{1}} | Clinician name | Dr. Sara     |
| {{2}} | Time           | 16:30        |
| {{3}} | Day/date       | 2026-08-01   |

> ⚠️ This is the P17 3-variable wording. The code previously sent 2 variables
> (clinician + combined date-time); the worker is corrected in this same
> change-set to send exactly {{1}}=clinician, {{2}}=time, {{3}}=day.

---

## 3a · appointment_rescheduled_ar — Category: **UTILITY** — Language: **ar**

```
مرحباً {{1}}، تم تعديل موعدك إلى تاريخ {{2}} الساعة {{3}}. بانتظارك.
```

| Var   | Meaning        | Sample value |
| ----- | -------------- | ------------ |
| {{1}} | اسم المريض     | سارة خليل    |
| {{2}} | التاريخ الجديد | 2026-08-02   |
| {{3}} | الوقت الجديد   | 17:00        |

## 3b · appointment_rescheduled_en — Category: **UTILITY** — Language: **en**

```
Hi {{1}}, your appointment has been rescheduled to {{2}} at {{3}}. See you then.
```

| Var   | Meaning      | Sample value |
| ----- | ------------ | ------------ |
| {{1}} | Patient name | Sara Khalil  |
| {{2}} | New date     | 2026-08-02   |
| {{3}} | New time     | 17:00        |

> Note (honest inventory): the app registers this template but no send path
> fires it yet — reschedule currently sends nothing. Submit it anyway so the
> approval exists when the send is wired (in the ledger).

---

## 4a · appointment_cancelled_ar — Category: **UTILITY** — Language: **ar**

```
نأسف، تم إلغاء موعدك بتاريخ {{1}} الساعة {{2}}. السبب: {{3}}. يمكنك حجز موعد جديد في أي وقت.
```

| Var   | Meaning     | Sample value         |
| ----- | ----------- | -------------------- |
| {{1}} | التاريخ     | 2026-08-01           |
| {{2}} | الوقت       | 16:30                |
| {{3}} | سبب الإلغاء | ظرف طارئ لدى العيادة |

## 4b · appointment_cancelled_en — Category: **UTILITY** — Language: **en**

```
Your appointment on {{1}} at {{2}} was cancelled. Reason: {{3}}. You can rebook anytime.
```

| Var   | Meaning             | Sample value     |
| ----- | ------------------- | ---------------- |
| {{1}} | Date                | 2026-08-01       |
| {{2}} | Time                | 16:30            |
| {{3}} | Cancellation reason | Clinic emergency |

---

## 5a · home_exercise_reminder_ar — Category: **UTILITY** — Language: **ar**

```
حان وقت تمرينك «{{1}}». ملاحظة المعالج: {{2}}. شاهد الفيديو عبر الرابط: {{3}} وواصل تمارينك.
```

| Var   | Meaning              | Sample value                                     |
| ----- | -------------------- | ------------------------------------------------ |
| {{1}} | اسم التمرين          | تمرين القرفصاء                                   |
| {{2}} | ملاحظة المعالج       | ثلاث مجموعات × عشر عدّات                         |
| {{3}} | رابط البوابة/الفيديو | https://theonephysio.com/ar/patient/home-program |

## 5b · home_exercise_reminder_en — Category: **UTILITY** — Language: **en**

```
Time for your exercise "{{1}}". Therapist note: {{2}}. Watch the video here: {{3}} and keep it up.
```

| Var   | Meaning           | Sample value                                     |
| ----- | ----------------- | ------------------------------------------------ |
| {{1}} | Exercise name     | Squat                                            |
| {{2}} | Therapist note    | 3 sets of 10 reps                                |
| {{3}} | Portal/video link | https://theonephysio.com/en/patient/home-program |

---

## 6a · otp_login_ar — Category: **AUTHENTICATION** — Language: **ar**

```
رمز الدخول إلى Theone.pt هو {{1}} وينتهي خلال 5 دقائق. لا تشاركه مع أحد.
```

| Var   | Meaning    | Sample value |
| ----- | ---------- | ------------ |
| {{1}} | رمز التحقق | 483920       |

## 6b · otp_login_en — Category: **AUTHENTICATION** — Language: **en**

```
Your Theone.pt login code is {{1}} and expires in 5 minutes. Do not share it.
```

| Var   | Meaning       | Sample value |
| ----- | ------------- | ------------ |
| {{1}} | One-time code | 483920       |

> Meta may force AUTHENTICATION templates into its fixed OTP layout (code +
> copy-code button). If the builder insists, accept the Authentication content
> type and put the code as the single variable — the app only fills {{1}}.

---

## 7a · patient_account_credentials_ar — Category: **UTILITY** — Language: **ar**

```
مرحباً بك في Theone.pt. اسم المستخدم: {{1}} وكلمة المرور المؤقتة: {{2}}. يرجى تغييرها عند أول تسجيل دخول.
```

| Var   | Meaning             | Sample value |
| ----- | ------------------- | ------------ |
| {{1}} | اسم المستخدم        | 962790000000 |
| {{2}} | كلمة المرور المؤقتة | Tmp-4x9Q2    |

## 7b · patient_account_credentials_en — Category: **UTILITY** — Language: **en**

```
Welcome to Theone.pt. Your username is {{1}} and temporary password is {{2}}. Please change it on first sign-in.
```

| Var   | Meaning            | Sample value |
| ----- | ------------------ | ------------ |
| {{1}} | Username           | 962790000000 |
| {{2}} | Temporary password | Tmp-4x9Q2    |

> This body was REJECTED once by Meta on the old WABA (credentials in
> messages). If it rejects again, we ship without it — the send path already
> skips inactive templates; do not block the other 12 on this one.

---

## Submission checklist (tonight)

1. Create all 14 as **Text** content in the Content Template Builder, names
   exactly as above (lowercase_snake — Twilio requires it).
2. On each: pick the **Category** listed, fill the sample values, and
   **Submit for WhatsApp approval** (button on the content page).
3. Meta review usually clears UTILITY overnight; AUTHENTICATION may need the
   fixed OTP format (see 6 note).
4. Tomorrow: copy each approved template's **Content SID (HX…)** into the app
   per `docs/whatsapp-twilio.md` §3 (14 SIDs total — ar+en are separate SIDs).

---

# v2 package (Prompt 48b) — R1/R2/R5/R6 **LIVE** (approved Jul 26, switched Jul 27 via P54)

**What "R1–R8" means (owner question, clarified):** the v2 pack is the four
appointment templates × two languages = EIGHT console entries, numbered in
submission order: R1/R2 = reminder ar/en (quick-reply buttons) ·
R3/R4 = confirmation ar/en · R5/R6 = rescheduled ar/en ·
R7/R8 = cancelled ar/en. **Only R1/R2/R5/R6 are switched and LIVE** —
confirmation (R3/R4) and cancellation (R7/R8) stay on their v1 templates by
owner decision; their v2 entries remain approved-but-unused until a future
wave.

New unified variable shape for the four switched templates:
**{{1}} patient name · {{2}} day name (localized weekday) · {{3}} date · {{4}} time**

The switch ran through `scripts/switch-templates-v2.ts` (audited, idempotent,
SIDs verified against the live Content API before apply — never from
chat/screenshots). Zero send-path code changes (48b design: the registry
row's SID + `variablesShape` drive everything).

## 🗑 Cleanup list (delete from Twilio in the cleanup session)

- `appointment_reminder_ar` / `appointment_reminder_en` (v1 — **REPLACED** by R1/R2)
- `appointment_rescheduled_ar` / `appointment_rescheduled_en` (v1 — **REPLACED** by R5/R6)
- The unused **+1 878** sandbox/number left from early setup

## R1 · appointment_reminder_ar_v2 — UTILITY — ar — **Quick reply**

```
مرحباً {{1}}، نذكّركم بموعدكم يوم {{2}} الموافق {{3}} الساعة {{4}}.
يرجى تأكيد الحضور بالضغط على أحد الخيارين أدناه، وفي حال الرغبة بتعديل أو إلغاء الموعد نرجو إبلاغنا قبل 24 ساعة.
في حال عدم الرد سيتم إلغاء الموعد.
```

Buttons (quick reply): `تأكيد الحضور` (id: `confirm`) · `عدم التأكيد` (id: `decline`)

## R2 · appointment_reminder_en_v2 — UTILITY — en — **Quick reply**

```
Hello {{1}}, this is a reminder of your appointment on {{2}}, {{3}} at {{4}}.
Please confirm by tapping an option below. To change or cancel, let us know at least 24 hours in advance.
If we receive no reply, the appointment will be cancelled.
```

Buttons: `Confirm attendance` (id: `confirm`) · `Can't confirm` (id: `decline`)

## R3/R4 · appointment*confirmation*{ar,en}\_v2 — UTILITY — Text

```
مرحباً {{1}}، تم تأكيد موعدكم يوم {{2}} الموافق {{3}} الساعة {{4}}. نراكم قريباً.
```

```
Hi {{1}}, your appointment is confirmed for {{2}}, {{3}} at {{4}}. See you soon.
```

## R5/R6 · appointment*rescheduled*{ar,en}\_v2 — UTILITY — Text

```
مرحباً {{1}}، تم تغيير موعدكم إلى يوم {{2}} الموافق {{3}} الساعة {{4}}. نراكم قريباً.
```

```
Hi {{1}}, your appointment has been moved to {{2}}, {{3}} at {{4}}. See you then.
```

## R7/R8 · appointment*cancelled*{ar,en}\_v2 — UTILITY — Text

```
مرحباً {{1}}، نأسف لإبلاغكم بإلغاء موعد يوم {{2}} الموافق {{3}} الساعة {{4}}. يمكنكم حجز موعد جديد في أي وقت.
```

```
Hi {{1}}, we're sorry — your appointment on {{2}}, {{3}} at {{4}} was cancelled. You can rebook anytime.
```

Sample values for every entry: {{1}} سارة خليل / Sara Khalil · {{2}} السبت / Saturday · {{3}} 2026-08-01 · {{4}} 16:30

> NOTE (48b scope): the reminder + rescheduled send paths are registry-driven
> today; confirmation + cancelled still build their legacy arrays in code —
> switch ONLY the reminder + rescheduled rows for now. Flipping the other two
> needs the small follow-up noted in the 48b report.
