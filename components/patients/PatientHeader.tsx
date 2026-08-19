'use client';

import { Stethoscope } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { ExportPatientFileButton } from '@/components/exports/ExportPatientFileButton';
import { ActAsButton } from '@/components/impersonation/ActAsButton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { patientDisplayName } from '@/lib/format/patientName';
import { formatPhone } from '@/lib/format/phone';
import type { PatientFileData } from '@/lib/patients/queries';
import { displayAgeYears } from '@/lib/patients/schemas';

/**
 * Patient header card — sits above the file tabs. Shows the avatar, both
 * locales of the name (active locale primary, the other beneath), age,
 * gender, assignment chips, and the patient's phone.
 *
 * `showActAs` is computed SERVER-SIDE from the impersonation-aware effective
 * session (real non-impersonating Admin only) — a client useSession() gate
 * here read the raw Auth.js session, which made the button appear inside
 * Secretary surfaces while an Admin was impersonating one, flash in after
 * hydration, and fail with ALREADY_IMPERSONATING when clicked (QA
 * Receptionist #7, Admin #18). The server action still enforces ADMIN-only
 * independently.
 */
export function PatientHeader({
  patient,
  showActAs = false,
  pendingFirstVisit = false,
  bookDoctorHref = null,
}: {
  patient: PatientFileData;
  showActAs?: boolean;
  /** NI-5 (Prompt 41): derived — no completed doctor visit yet. */
  pendingFirstVisit?: boolean;
  /** NI-5 CTA target (secretary/admin only); null hides the button. */
  bookDoctorHref?: string | null;
}) {
  const locale = useLocale();
  const tForm = useTranslations('patients.form');
  const tFirstVisit = useTranslations('patients.firstVisit');
  const name = patientDisplayName(patient.fullNameEn, patient.fullNameAr, locale);

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  // P52: sentinel DOB (unknown, year <= 1900) renders as an em-dash.
  const ageYears = displayAgeYears(patient.dateOfBirth);

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-md border border-brand-border bg-brand-surface p-4">
      <Avatar className="size-14">
        <AvatarFallback className="text-base">{initials}</AvatarFallback>
      </Avatar>
      <div className="flex-1 space-y-1">
        <h1 className="text-2xl font-medium text-brand-navy">{name}</h1>
        {/* P47 row 8 — the other-script subtitle is gone; English is the name. */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="muted">{ageYears === null ? '\u2014' : `${ageYears}y`}</Badge>
          <Badge variant="muted">
            {/* P50: null gender (imported records) renders an em-dash, never
                a silent "Male" fallback. */}
            {patient.gender
              ? patient.gender === 'FEMALE'
                ? tForm('genderFemale')
                : tForm('genderMale')
              : '—'}
          </Badge>
          {/* NI-5 soft flag (Prompt 41): calm chip until the first COMPLETED
              doctor visit; cancelled/no-show keep it on. */}
          {pendingFirstVisit ? (
            <Badge variant="outline" className="border-amber-400/60 bg-amber-50 text-amber-800">
              {tFirstVisit('awaitingBadge')}
            </Badge>
          ) : null}
          {/* Phone is null for Doctor/Therapist viewers (Prompt 15 §1) — omit it. */}
          {patient.phone ? (
            <span className="font-mono text-brand-textMuted" dir="ltr">
              {formatPhone(patient.phone)}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {/* NI-5 CTA (Prompt 41, owner ruling: SOFT) — prominent while the
            first doctor visit is pending; disappears once completed. */}
        {pendingFirstVisit && bookDoctorHref ? (
          <Button asChild size="sm">
            <Link href={bookDoctorHref as `/${string}`}>
              <Stethoscope className="me-2 size-4" />
              {tFirstVisit('bookDoctorCta')}
            </Link>
          </Button>
        ) : null}
        {showActAs ? (
          <ActAsButton targetUserId={patient.id} targetName={name} variant="button" />
        ) : null}
        <ExportPatientFileButton patientId={patient.id} locale={locale} />
      </div>
    </div>
  );
}
