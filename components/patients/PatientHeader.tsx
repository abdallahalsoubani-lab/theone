'use client';

import { useLocale } from 'next-intl';
import { useSession } from 'next-auth/react';

import { ExportPatientFileButton } from '@/components/exports/ExportPatientFileButton';
import { ActAsButton } from '@/components/impersonation/ActAsButton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { formatPhone } from '@/lib/format/phone';
import type { PatientFileData } from '@/lib/patients/queries';

/**
 * Patient header card — sits above the file tabs. Shows the avatar, both
 * locales of the name (active locale primary, the other beneath), age,
 * gender, assignment chips, and the patient's phone.
 */
export function PatientHeader({ patient }: { patient: PatientFileData }) {
  const locale = useLocale();
  const { data: session } = useSession();
  // Only render the "Act as patient" entry point for Admins. The server
  // action behind ActAsButton enforces this independently — the UI gate
  // is purely to avoid showing a button that would always fail for
  // Secretary / Doctor / Therapist viewers of the same profile.
  const viewerIsAdmin = session?.user?.role === 'ADMIN';
  const name = locale === 'ar' ? patient.fullNameAr : patient.fullNameEn;
  const alt = locale === 'ar' ? patient.fullNameEn : patient.fullNameAr;
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const ageMs = Date.now() - patient.dateOfBirth.getTime();
  const ageYears = Math.floor(ageMs / (365.25 * 24 * 60 * 60 * 1000));

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-md border border-brand-border bg-brand-surface p-4">
      <Avatar className="size-14">
        <AvatarFallback className="text-base">{initials}</AvatarFallback>
      </Avatar>
      <div className="flex-1 space-y-1">
        <h1 className="text-2xl font-medium text-brand-navy">{name}</h1>
        <p className="text-sm text-brand-textMuted">{alt}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="muted">{ageYears}y</Badge>
          <Badge variant="muted">{patient.gender}</Badge>
          <span className="font-mono text-brand-textMuted" dir="ltr">
            {formatPhone(patient.phone)}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {viewerIsAdmin ? (
          <ActAsButton targetUserId={patient.id} targetName={name} variant="button" />
        ) : null}
        <ExportPatientFileButton patientId={patient.id} locale={locale} />
      </div>
    </div>
  );
}
