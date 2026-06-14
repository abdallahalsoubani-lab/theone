'use client';

import { Download, FileText, Loader2, Trash2, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  createDocumentUploadTicket,
  deleteDocument,
  finalizeDocumentUpload,
} from '@/lib/patient-documents/actions';
import { PATIENT_DOC_MAX_BYTES, PATIENT_DOC_MIME_TYPES } from '@/lib/patient-documents/policy';
import type { DocumentListRow } from '@/lib/patient-documents/queries';

type Category = 'XRAY' | 'LAB' | 'CONSULT' | 'REPORT' | 'OTHER';
const CATEGORIES: Category[] = ['XRAY', 'LAB', 'CONSULT', 'REPORT', 'OTHER'];

export interface ReportLinks {
  patientId: string;
  /** Active treatment plan id, if any. */
  planId: string | null;
  /** Most recent pediatric assessment id, if any. */
  pediatricId: string | null;
  /** Most recent primary session note id, if any. */
  noteId: string | null;
}

interface Props {
  patientId: string;
  locale: 'en' | 'ar';
  documents: DocumentListRow[];
  canUpload: boolean;
  canDelete: boolean;
  reports: ReportLinks;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function PatientDocumentsTab({
  patientId,
  locale,
  documents,
  canUpload,
  canDelete,
  reports,
}: Props) {
  const t = useTranslations('patients.documents');
  const inputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<Category>('REPORT');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const maxMb = Math.round(PATIENT_DOC_MAX_BYTES / (1024 * 1024));

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!(PATIENT_DOC_MIME_TYPES as readonly string[]).includes(file.type)) {
      toast.error(t('errorUnsupported'));
      return;
    }
    if (file.size <= 0 || file.size > PATIENT_DOC_MAX_BYTES) {
      toast.error(t('errorTooLarge', { maxMb }));
      return;
    }
    setBusy(true);
    try {
      const ticket = await createDocumentUploadTicket({
        patientId,
        fileName: file.name,
        category,
        note: note.trim() || undefined,
        contentType: file.type,
        sizeBytes: file.size,
      });
      if (!ticket.ok) {
        toast.error(locale === 'ar' ? ticket.error.message_ar : ticket.error.message_en);
        return;
      }
      const put = await fetch(ticket.data.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!put.ok) {
        toast.error(t('errorUploadFailed'));
        return;
      }
      const fin = await finalizeDocumentUpload({ documentId: ticket.data.documentId });
      if (!fin.ok) {
        toast.error(locale === 'ar' ? fin.error.message_ar : fin.error.message_en);
        return;
      }
      toast.success(t('uploadSuccess'));
      setNote('');
      startTransition(() => {
        window.location.reload();
      });
    } catch {
      toast.error(t('errorUploadFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(documentId: string) {
    const res = await deleteDocument({ documentId });
    if (!res.ok) {
      toast.error(locale === 'ar' ? res.error.message_ar : res.error.message_en);
      return;
    }
    toast.success(t('deleteSuccess'));
    window.location.reload();
  }

  const reportItems: Array<{ key: string; label: string; href: string }> = [
    {
      key: 'patient-file',
      label: t('reportPatientFile'),
      href: `/api/v1/exports/patient-file/${reports.patientId}?locale=${locale}`,
    },
  ];
  if (reports.planId) {
    reportItems.push({
      key: 'plan',
      label: t('reportTreatmentPlan'),
      href: `/api/v1/exports/treatment-plan/${reports.planId}?locale=${locale}`,
    });
  }
  if (reports.noteId) {
    reportItems.push({
      key: 'note',
      label: t('reportSessionReport'),
      href: `/api/v1/exports/session-report/${reports.noteId}?locale=${locale}`,
    });
  }
  if (reports.pediatricId) {
    reportItems.push({
      key: 'pediatric',
      label: t('reportPediatric'),
      href: `/api/v1/exports/pediatric-assessment/${reports.pediatricId}?locale=${locale}`,
    });
  }

  return (
    <div className="space-y-8">
      {/* Reports — one-click downloads of generated system PDFs. */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-brand-navy">{t('reportsHeading')}</h3>
        <div className="flex flex-wrap gap-2">
          {reportItems.map((r) => (
            <Button key={r.key} asChild variant="outline" size="sm">
              <a href={r.href} target="_blank" rel="noreferrer">
                <FileText className="me-2 size-4" />
                {r.label}
              </a>
            </Button>
          ))}
        </div>
      </section>

      {/* Uploaded documents. */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-brand-navy">{t('documentsHeading')}</h3>
        </div>

        {canUpload ? (
          <div className="space-y-3 rounded-md border border-brand-border bg-brand-surface p-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-brand-textMuted">{t('category')}</span>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as Category)}
                  className="h-9 rounded-md border border-brand-border bg-brand-bg px-2 text-sm"
                  disabled={busy}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`cat${c}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-1 flex-col gap-1 text-sm">
                <span className="text-brand-textMuted">{t('noteOptional')}</span>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={1000}
                  className="h-9 rounded-md border border-brand-border bg-brand-bg px-2 text-sm"
                  disabled={busy}
                />
              </label>
              <input
                ref={inputRef}
                type="file"
                accept={PATIENT_DOC_MIME_TYPES.join(',')}
                className="hidden"
                onChange={handleFile}
              />
              <Button type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
                {busy ? (
                  <Loader2 className="me-2 size-4 animate-spin" />
                ) : (
                  <Upload className="me-2 size-4" />
                )}
                {t('uploadButton')}
              </Button>
            </div>
            <p className="text-xs text-brand-textMuted">{t('uploadHint', { maxMb })}</p>
          </div>
        ) : null}

        {documents.length === 0 ? (
          <p className="rounded-md border border-dashed border-brand-border bg-brand-bg p-8 text-center text-sm text-brand-textMuted">
            {t('empty')}
          </p>
        ) : (
          <ul className="divide-y divide-brand-border rounded-md border border-brand-border">
            {documents.map((d) => (
              <li key={d.id} className="flex items-center gap-3 p-3">
                <Badge variant="outline">{t(`cat${d.category}`)}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-brand-navy">{d.fileName}</p>
                  <p className="text-xs text-brand-textMuted">
                    {formatBytes(d.sizeBytes)} ·{' '}
                    {locale === 'ar' ? d.uploadedByNameAr : d.uploadedByNameEn} ·{' '}
                    {d.createdAt.slice(0, 10)}
                    {d.note ? ` · ${d.note}` : ''}
                  </p>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <a href={`/api/v1/documents/${d.id}`} target="_blank" rel="noreferrer">
                    <Download className="me-1 size-4" />
                    {t('download')}
                  </a>
                </Button>
                {canDelete ? (
                  <ConfirmDialog
                    title={t('deleteTitle')}
                    description={t('deleteConfirm', { name: d.fileName })}
                    variant="destructive"
                    onConfirm={() => handleDelete(d.id)}
                    trigger={
                      <Button variant="ghost" size="sm" className="text-red-600">
                        <Trash2 className="size-4" />
                      </Button>
                    }
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
