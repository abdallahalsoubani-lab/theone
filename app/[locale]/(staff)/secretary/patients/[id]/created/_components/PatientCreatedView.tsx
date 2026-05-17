'use client';

import { CheckCircle2, Copy, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

interface Props {
  patientId: string;
  name: string;
  tempPassword: string | null;
  whatsappOk: boolean;
  title: string;
  subtitle: string;
  tempPasswordHeading: string;
  tempPasswordHint: string;
  copyLabel: string;
  copiedLabel: string;
  whatsappOkLabel: string;
  whatsappFailedLabel: string;
  ctaIntakeLabel: string;
  ctaListLabel: string;
}

export function PatientCreatedView({
  patientId,
  tempPassword,
  whatsappOk,
  title,
  subtitle,
  tempPasswordHeading,
  tempPasswordHint,
  copyLabel,
  copiedLabel,
  whatsappOkLabel,
  whatsappFailedLabel,
  ctaIntakeLabel,
  ctaListLabel,
}: Props) {
  return (
    <section className="mx-auto max-w-xl space-y-6 p-6">
      <header className="space-y-2 text-center">
        <CheckCircle2 className="mx-auto size-12 text-brand-teal" />
        <h1 className="text-2xl font-medium text-brand-navy">{title}</h1>
        <p className="text-sm text-brand-textMuted">{subtitle}</p>
      </header>

      {whatsappOk ? (
        <p className="rounded-md bg-brand-bg px-3 py-2 text-center text-sm text-brand-navy">
          {whatsappOkLabel}
        </p>
      ) : (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          <TriangleAlert className="size-4 shrink-0" />
          <span>{whatsappFailedLabel}</span>
        </p>
      )}

      <Card>
        <CardContent className="space-y-3 p-6">
          <p className="text-xs font-medium uppercase tracking-wider text-brand-textMuted">
            {tempPasswordHeading}
          </p>
          <p className="text-xs text-brand-textMuted">{tempPasswordHint}</p>
          {tempPassword ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-brand-border bg-brand-bg px-3 py-2">
              <code className="font-mono text-base text-brand-navy">{tempPassword}</code>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  void navigator.clipboard?.writeText(tempPassword);
                  toast.success(copiedLabel);
                }}
              >
                <Copy className="me-1 size-4" /> {copyLabel}
              </Button>
            </div>
          ) : (
            <p className="rounded-md border border-brand-border bg-brand-bg px-3 py-2 text-sm text-brand-textMuted">
              —
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button asChild variant="outline">
          <Link href="/secretary/patients">{ctaListLabel}</Link>
        </Button>
        <Button asChild>
          <Link href={`/secretary/patients/${patientId}/intake/new`}>{ctaIntakeLabel}</Link>
        </Button>
      </div>
    </section>
  );
}
