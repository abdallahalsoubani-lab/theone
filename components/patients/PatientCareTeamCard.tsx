'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { CareTeamEditor } from '@/components/patients/CareTeamEditor';
import { Card, CardContent } from '@/components/ui/card';
import { addCareTeamMemberAction, removeCareTeamMemberAction } from '@/lib/patients/actions';
import type { ClinicianRef } from '@/lib/patients/assignment';

/**
 * Live care-team editor on the patient edit page (Secretary/Admin). Each
 * add/remove hits an audited server action immediately and re-syncs the
 * server components — distinct from the demographics form below, which has
 * its own save button.
 */
export function PatientCareTeamCard({
  patientId,
  initialTherapists,
  initialDoctors,
  therapistOptions,
  doctorOptions,
}: {
  patientId: string;
  initialTherapists: ClinicianRef[];
  initialDoctors: ClinicianRef[];
  therapistOptions: ClinicianRef[];
  doctorOptions: ClinicianRef[];
}) {
  const t = useTranslations('patients.careTeam');
  const locale = useLocale();
  const router = useRouter();
  const [therapists, setTherapists] = useState(initialTherapists);
  const [doctors, setDoctors] = useState(initialDoctors);
  const [isPending, startTransition] = useTransition();

  const refFor = (clinicianId: string): { ref: ClinicianRef; isTherapist: boolean } | null => {
    const th = therapistOptions.find((c) => c.id === clinicianId);
    if (th) return { ref: th, isTherapist: true };
    const dr = doctorOptions.find((c) => c.id === clinicianId);
    if (dr) return { ref: dr, isTherapist: false };
    return null;
  };

  const handleAdd = (clinicianId: string) => {
    const found = refFor(clinicianId);
    if (!found) return;
    startTransition(async () => {
      const r = await addCareTeamMemberAction(patientId, clinicianId);
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      if (found.isTherapist) setTherapists((prev) => [...prev, found.ref]);
      else setDoctors((prev) => [...prev, found.ref]);
      toast.success(t('addedToast'));
      router.refresh();
    });
  };

  const handleRemove = (clinicianId: string) => {
    const found = refFor(clinicianId);
    startTransition(async () => {
      const r = await removeCareTeamMemberAction(patientId, clinicianId);
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      if (found?.isTherapist ?? true) {
        setTherapists((prev) => prev.filter((c) => c.id !== clinicianId));
      }
      setDoctors((prev) => prev.filter((c) => c.id !== clinicianId));
      toast.success(t('removedToast'));
      router.refresh();
    });
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div>
          <h2 className="text-lg font-medium text-brand-navy">{t('title')}</h2>
          <p className="text-sm text-brand-textMuted">{t('help')}</p>
        </div>
        <CareTeamEditor
          therapists={therapists}
          doctors={doctors}
          therapistOptions={therapistOptions}
          doctorOptions={doctorOptions}
          onAdd={handleAdd}
          onRemove={handleRemove}
          disabled={isPending}
        />
      </CardContent>
    </Card>
  );
}
