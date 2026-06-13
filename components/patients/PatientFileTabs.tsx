'use client';

import {
  Activity,
  Baby,
  Calendar,
  ClipboardList,
  FileText,
  Home,
  Stethoscope,
  User,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type TabKey =
  | 'profile'
  | 'intake'
  | 'appointments'
  | 'plan'
  | 'notes'
  | 'home'
  | 'pediatric'
  | 'timeline'
  | 'activity';

interface Props {
  defaultTab?: TabKey;
  profile: ReactNode;
  intake: ReactNode;
  activity: ReactNode;
  /** Treatment-plan tab content (Prompt 9). Falls back to the placeholder if omitted. */
  plan?: ReactNode;
  /** Session-notes tab content (Prompt 9). Falls back to the placeholder if omitted. */
  notes?: ReactNode;
  /** Clinical timeline (Prompt 9). Falls back to the placeholder if omitted. */
  timeline?: ReactNode;
  /** Home program (Prompt 10). Falls back to the placeholder if omitted. */
  homeProgram?: ReactNode;
  /** Pediatric assessment (Prompt 21). Shown only when the viewer can read it. */
  pediatric?: ReactNode;
}

export function PatientFileTabs({
  defaultTab = 'profile',
  profile,
  intake,
  activity,
  plan,
  notes,
  timeline,
  homeProgram,
  pediatric,
}: Props) {
  const t = useTranslations('patients.file');

  return (
    <Tabs defaultValue={defaultTab}>
      <TabsList className="flex w-full flex-wrap justify-start gap-1">
        <TabsTrigger value="profile">
          <User className="me-2 size-4" />
          {t('tabProfile')}
        </TabsTrigger>
        <TabsTrigger value="intake">
          <ClipboardList className="me-2 size-4" />
          {t('tabIntake')}
        </TabsTrigger>
        <TabsTrigger value="appointments">
          <Calendar className="me-2 size-4" />
          {t('tabAppointments')}
        </TabsTrigger>
        <TabsTrigger value="plan">
          <Stethoscope className="me-2 size-4" />
          {t('tabTreatmentPlan')}
        </TabsTrigger>
        <TabsTrigger value="notes">
          <FileText className="me-2 size-4" />
          {t('tabSessionNotes')}
        </TabsTrigger>
        <TabsTrigger value="home">
          <Home className="me-2 size-4" />
          {t('tabHomeProgram')}
        </TabsTrigger>
        {pediatric ? (
          <TabsTrigger value="pediatric">
            <Baby className="me-2 size-4" />
            {t('tabPediatric')}
          </TabsTrigger>
        ) : null}
        <TabsTrigger value="timeline">
          <Activity className="me-2 size-4" />
          {t('tabTimeline')}
        </TabsTrigger>
        <TabsTrigger value="activity">
          <Activity className="me-2 size-4" />
          {t('tabActivity')}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="profile">{profile}</TabsContent>
      <TabsContent value="intake">{intake}</TabsContent>

      {/* Placeholders owned by later prompts (Prompt 7 / 9 / 10). */}
      <TabsContent value="appointments">
        <Placeholder
          icon={<Calendar className="size-6" />}
          message={t('placeholderAppointments')}
        />
      </TabsContent>
      <TabsContent value="plan">
        {plan ?? (
          <Placeholder
            icon={<Stethoscope className="size-6" />}
            message={t('placeholderTreatmentPlan')}
          />
        )}
      </TabsContent>
      <TabsContent value="notes">
        {notes ?? (
          <Placeholder
            icon={<FileText className="size-6" />}
            message={t('placeholderSessionNotes')}
          />
        )}
      </TabsContent>
      <TabsContent value="home">
        {homeProgram ?? (
          <Placeholder icon={<Home className="size-6" />} message={t('placeholderHomeProgram')} />
        )}
      </TabsContent>
      {pediatric ? <TabsContent value="pediatric">{pediatric}</TabsContent> : null}
      <TabsContent value="timeline">
        {timeline ?? (
          <Placeholder icon={<Activity className="size-6" />} message={t('placeholderTimeline')} />
        )}
      </TabsContent>

      <TabsContent value="activity">{activity}</TabsContent>
    </Tabs>
  );
}

function Placeholder({ icon, message }: { icon: ReactNode; message: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-brand-border bg-brand-bg p-12 text-center text-brand-textMuted">
      {icon}
      <p className="text-sm">{message}</p>
    </div>
  );
}
