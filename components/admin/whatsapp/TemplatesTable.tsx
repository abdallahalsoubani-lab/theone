'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { sendTestMessageAction, updateTemplateAction } from '@/lib/admin/whatsapp/actions';
import type { TemplateListRow } from '@/lib/admin/whatsapp/queries';

interface Props {
  rows: TemplateListRow[];
}

/**
 * Admin templates table.
 *
 * Inline edits are kept minimal: toggle active, edit Meta template name +
 * approval status, and a "Send test" button that prompts for a phone number.
 * A future enhancement could move this into a side panel with a richer form;
 * v1 keeps the surface tight.
 */
export function TemplatesTable({ rows }: Props) {
  const t = useTranslations('admin.whatsapp');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<TemplateListRow | null>(null);
  const [testTarget, setTestTarget] = useState<{ id: string; phone: string } | null>(null);

  function beginEdit(row: TemplateListRow) {
    setDraft({ ...row });
    setEditing(row.id);
  }

  function cancelEdit() {
    setEditing(null);
    setDraft(null);
  }

  function saveEdit() {
    if (!draft) return;
    startTransition(async () => {
      const r = await updateTemplateAction({
        id: draft.id,
        metaTemplateName: draft.metaTemplateName,
        metaApprovalStatus: draft.metaApprovalStatus as
          | 'NOT_SUBMITTED'
          | 'PENDING'
          | 'APPROVED'
          | 'REJECTED'
          | 'PAUSED',
        active: draft.active,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(t('savedToast'));
      cancelEdit();
      router.refresh();
    });
  }

  function sendTest() {
    if (!testTarget) return;
    const phone = testTarget.phone.trim();
    if (!phone.startsWith('+')) {
      toast.error(t('phoneInvalid'));
      return;
    }
    startTransition(async () => {
      const r = await sendTestMessageAction({ templateId: testTarget.id, recipientPhone: phone });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(t('testSentToast'));
      setTestTarget(null);
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-brand-border bg-brand-surface p-12 text-center text-sm text-brand-textMuted">
        {t('emptyTemplates')}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-brand-border bg-brand-surface">
      <table className="min-w-full text-sm">
        <thead className="border-b border-brand-border bg-brand-bg">
          <tr>
            <th className="px-3 py-2 text-start font-medium text-brand-textMuted">{t('name')}</th>
            <th className="px-3 py-2 text-start font-medium text-brand-textMuted">
              {t('language')}
            </th>
            <th className="px-3 py-2 text-start font-medium text-brand-textMuted">
              {t('category')}
            </th>
            <th className="px-3 py-2 text-start font-medium text-brand-textMuted">
              {t('preview')}
            </th>
            <th className="px-3 py-2 text-start font-medium text-brand-textMuted">Meta</th>
            <th className="px-3 py-2 text-start font-medium text-brand-textMuted">{t('active')}</th>
            <th className="px-3 py-2 text-end font-medium text-brand-textMuted">{t('actions')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isEditing = editing === row.id;
            const current = isEditing && draft ? draft : row;
            return (
              <tr key={row.id} className="border-b border-brand-border align-top last:border-0">
                <td className="px-3 py-3 font-mono text-xs text-brand-navy">{row.name}</td>
                <td className="px-3 py-3 text-brand-textMuted">{row.language}</td>
                <td className="px-3 py-3 text-brand-textMuted">{row.category}</td>
                <td className="max-w-xs px-3 py-3 text-xs text-brand-text">
                  <div className="line-clamp-2">{row.contentPreview}</div>
                </td>
                <td className="px-3 py-3">
                  {isEditing ? (
                    <div className="space-y-1">
                      <Input
                        value={current.metaTemplateName ?? ''}
                        onChange={(e) =>
                          setDraft({ ...current, metaTemplateName: e.target.value || null })
                        }
                        className="h-7 text-xs"
                      />
                      <select
                        value={current.metaApprovalStatus}
                        onChange={(e) =>
                          setDraft({ ...current, metaApprovalStatus: e.target.value })
                        }
                        className="h-7 w-full rounded-md border border-brand-border bg-brand-surface px-2 text-xs"
                      >
                        <option value="NOT_SUBMITTED">NOT_SUBMITTED</option>
                        <option value="PENDING">PENDING</option>
                        <option value="APPROVED">APPROVED</option>
                        <option value="REJECTED">REJECTED</option>
                        <option value="PAUSED">PAUSED</option>
                      </select>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div className="font-mono text-xs text-brand-textMuted">
                        {row.metaTemplateName ?? '—'}
                      </div>
                      <ApprovalBadge status={row.metaApprovalStatus} />
                    </div>
                  )}
                </td>
                <td className="px-3 py-3">
                  {isEditing ? (
                    <input
                      type="checkbox"
                      checked={current.active}
                      onChange={(e) => setDraft({ ...current, active: e.target.checked })}
                    />
                  ) : row.active ? (
                    <Badge variant="default">{t('on')}</Badge>
                  ) : (
                    <Badge variant="muted">{t('off')}</Badge>
                  )}
                </td>
                <td className="px-3 py-3 text-end">
                  {isEditing ? (
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={cancelEdit} disabled={pending}>
                        {t('cancel')}
                      </Button>
                      <Button size="sm" onClick={saveEdit} disabled={pending}>
                        {t('save')}
                      </Button>
                    </div>
                  ) : testTarget?.id === row.id ? (
                    <div className="flex flex-col items-end gap-2">
                      <Input
                        placeholder="+962…"
                        value={testTarget.phone}
                        onChange={(e) => setTestTarget({ ...testTarget, phone: e.target.value })}
                        className="h-7 w-44 text-xs"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setTestTarget(null)}
                          disabled={pending}
                        >
                          {t('cancel')}
                        </Button>
                        <Button size="sm" onClick={sendTest} disabled={pending}>
                          {t('send')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setTestTarget({ id: row.id, phone: '' })}
                      >
                        {t('sendTest')}
                      </Button>
                      <Button size="sm" onClick={() => beginEdit(row)}>
                        {t('edit')}
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-brand-border bg-brand-bg px-3 py-2 text-xs text-brand-textMuted">
        {locale === 'ar' ? 'إجمالي القوالب: ' : 'Total templates: '}
        {rows.length}
      </p>
    </div>
  );
}

function ApprovalBadge({ status }: { status: string }) {
  const t = useTranslations('admin.whatsapp');
  switch (status) {
    case 'APPROVED':
      return <Badge variant="default">{t('approved')}</Badge>;
    case 'PENDING':
      return <Badge variant="outline">{t('pending')}</Badge>;
    case 'REJECTED':
      return <Badge variant="destructive">{t('rejected')}</Badge>;
    case 'PAUSED':
      return <Badge variant="muted">{t('paused')}</Badge>;
    case 'NOT_SUBMITTED':
    default:
      return <Badge variant="muted">{t('notSubmitted')}</Badge>;
  }
}
