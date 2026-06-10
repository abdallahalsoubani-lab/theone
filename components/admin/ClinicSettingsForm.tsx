'use client';

import { LanguagePref } from '@prisma/client';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { updateClinicSettingsAction } from '@/lib/admin/clinic-settings/actions';
import type { ClinicSettingsUpdateInput } from '@/lib/admin/clinic-settings/schemas';

interface ServiceTypeRow {
  id: string;
  nameEn: string;
  nameAr: string;
  defaultDurationMinutes: number;
  active: boolean;
}

interface Props {
  initial: ClinicSettingsUpdateInput & { serviceTypes: ServiceTypeRow[] };
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
type Day = (typeof DAYS)[number];

/**
 * Single-page tabbed editor for ClinicSettings (Prompt 11 §4.5).
 * Tabs: General, Hours, Appointments, Languages + Clinical privacy,
 * Service types.
 *
 * The conflict engine reads `businessHours` on every appointment
 * creation — its JSON shape is locked to {sun..sat: {open, close,
 * closed}}. The form is the only sanctioned editor for that shape.
 */
export function ClinicSettingsForm({ initial }: Props) {
  const t = useTranslations('admin.settings');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [state, setState] = useState<ClinicSettingsUpdateInput>(initial);

  function setField<K extends keyof ClinicSettingsUpdateInput>(
    key: K,
    value: ClinicSettingsUpdateInput[K],
  ) {
    setState((prev) => ({ ...prev, [key]: value }));
  }

  function setHours(day: Day, patch: Partial<ClinicSettingsUpdateInput['businessHours'][Day]>) {
    setState((prev) => ({
      ...prev,
      businessHours: {
        ...prev.businessHours,
        [day]: { ...prev.businessHours[day], ...patch },
      },
    }));
  }

  function submit() {
    startTransition(async () => {
      const r = await updateClinicSettingsAction(state);
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(t('savedToast'));
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-6"
    >
      <Tabs defaultValue="general" className="w-full">
        <TabsList>
          <TabsTrigger value="general">{t('tabs.general')}</TabsTrigger>
          <TabsTrigger value="hours">{t('tabs.hours')}</TabsTrigger>
          <TabsTrigger value="appointments">{t('tabs.appointments')}</TabsTrigger>
          <TabsTrigger value="languages">{t('tabs.languages')}</TabsTrigger>
          <TabsTrigger value="services">{t('tabs.services')}</TabsTrigger>
          <TabsTrigger value="privacy">{t('tabs.privacy')}</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('fields.nameEn')}>
              <Input value={state.nameEn} onChange={(e) => setField('nameEn', e.target.value)} />
            </Field>
            <Field label={t('fields.nameAr')}>
              <Input value={state.nameAr} onChange={(e) => setField('nameAr', e.target.value)} />
            </Field>
            <Field label={t('fields.phone')}>
              <Input value={state.phone} onChange={(e) => setField('phone', e.target.value)} />
            </Field>
            <Field label={t('fields.timezone')}>
              <Input value="Asia/Amman" readOnly disabled />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('fields.addressEn')}>
              <textarea
                value={state.addressEn}
                onChange={(e) => setField('addressEn', e.target.value)}
                rows={3}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </Field>
            <Field label={t('fields.addressAr')}>
              <textarea
                value={state.addressAr}
                onChange={(e) => setField('addressAr', e.target.value)}
                rows={3}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </Field>
          </div>
        </TabsContent>

        <TabsContent value="hours" className="space-y-3">
          <p className="text-xs text-brand-textMuted">{t('hoursHint')}</p>
          <div className="space-y-2">
            {DAYS.map((day) => (
              <div
                key={day}
                className="grid grid-cols-[100px_80px_1fr_1fr] items-center gap-2 rounded-md border border-brand-border px-3 py-2"
              >
                <span className="font-medium">{t(`days.${day}`)}</span>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={!state.businessHours[day].closed}
                    onChange={(e) => setHours(day, { closed: !e.target.checked })}
                  />
                  {t('open')}
                </label>
                <Input
                  type="time"
                  value={state.businessHours[day].open}
                  disabled={state.businessHours[day].closed}
                  onChange={(e) => setHours(day, { open: e.target.value })}
                />
                <Input
                  type="time"
                  value={state.businessHours[day].close}
                  disabled={state.businessHours[day].closed}
                  onChange={(e) => setHours(day, { close: e.target.value })}
                />
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="appointments" className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('fields.defaultDuration')}>
              <Input
                type="number"
                min={5}
                max={480}
                value={state.defaultAppointmentDuration}
                onChange={(e) =>
                  setField('defaultAppointmentDuration', parseInt(e.target.value || '30', 10))
                }
              />
            </Field>
            <Field label={t('fields.reminderOffset')}>
              <Input
                type="number"
                min={5}
                max={24 * 60}
                value={state.defaultReminderOffsetMinutes}
                onChange={(e) =>
                  setField('defaultReminderOffsetMinutes', parseInt(e.target.value || '1440', 10))
                }
              />
            </Field>
            <Field label={t('fields.reminderWindowStart')}>
              <Input
                type="time"
                value={state.reminderWindowStart}
                onChange={(e) => setField('reminderWindowStart', e.target.value)}
              />
            </Field>
            <Field label={t('fields.reminderWindowEnd')}>
              <Input
                type="time"
                value={state.reminderWindowEnd}
                onChange={(e) => setField('reminderWindowEnd', e.target.value)}
              />
            </Field>
            <Field label={t('fields.currentDelayMinutes')}>
              <Input
                type="number"
                min={0}
                max={240}
                value={state.currentDelayMinutes}
                onChange={(e) =>
                  setField('currentDelayMinutes', parseInt(e.target.value || '10', 10))
                }
              />
            </Field>
          </div>
        </TabsContent>

        <TabsContent value="languages" className="space-y-3">
          <Field label={t('fields.defaultLanguage')}>
            <select
              value={state.defaultLanguage}
              onChange={(e) => setField('defaultLanguage', e.target.value as LanguagePref)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value={LanguagePref.AR}>العربية</option>
              <option value={LanguagePref.EN}>English</option>
            </select>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={state.hijriDefault}
              onChange={(e) => setField('hijriDefault', e.target.checked)}
            />
            {t('fields.hijriDefault')}
          </label>
        </TabsContent>

        <TabsContent value="services" className="space-y-3">
          <p className="text-xs text-brand-textMuted">{t('servicesHint')}</p>
          <div className="space-y-2">
            {state.serviceTypes.map((s, i) => (
              <div
                key={s.id}
                className="grid grid-cols-[1fr_1fr_100px_80px_60px] items-center gap-2 rounded-md border border-brand-border px-3 py-2"
              >
                <Input
                  value={s.nameEn}
                  onChange={(e) => updateServiceType(setState, i, { nameEn: e.target.value })}
                />
                <Input
                  value={s.nameAr}
                  onChange={(e) => updateServiceType(setState, i, { nameAr: e.target.value })}
                />
                <Input
                  type="number"
                  min={5}
                  max={480}
                  value={s.defaultDurationMinutes}
                  onChange={(e) =>
                    updateServiceType(setState, i, {
                      defaultDurationMinutes: parseInt(e.target.value || '30', 10),
                    })
                  }
                />
                <label className="text-xs">
                  <input
                    type="checkbox"
                    checked={s.active}
                    onChange={(e) => updateServiceType(setState, i, { active: e.target.checked })}
                    className="me-1"
                  />
                  {t('active')}
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={state.serviceTypes.length <= 1}
                  onClick={() =>
                    setState((prev) => ({
                      ...prev,
                      serviceTypes: prev.serviceTypes.filter((_, idx) => idx !== i),
                    }))
                  }
                >
                  {tCommon('remove')}
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setState((prev) => ({
                  ...prev,
                  serviceTypes: [
                    ...prev.serviceTypes,
                    {
                      id: `svc_${Date.now()}`,
                      nameEn: '',
                      nameAr: '',
                      defaultDurationMinutes: 30,
                      active: true,
                    },
                  ],
                }))
              }
            >
              {t('addService')}
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="privacy" className="space-y-3">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={state.patientCanViewClinicalNotes}
              onChange={(e) => setField('patientCanViewClinicalNotes', e.target.checked)}
            />
            <span>
              <span className="font-medium">{t('fields.patientCanViewClinicalNotes')}</span>
              <br />
              <span className="text-xs text-brand-textMuted">
                {t('fields.patientCanViewClinicalNotesHelp')}
              </span>
            </span>
          </label>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? t('saving') : t('save')}
        </Button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function updateServiceType(
  setState: React.Dispatch<React.SetStateAction<ClinicSettingsUpdateInput>>,
  i: number,
  patch: Partial<ServiceTypeRow>,
) {
  setState((prev) => ({
    ...prev,
    serviceTypes: prev.serviceTypes.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
  }));
}
