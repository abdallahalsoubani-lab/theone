'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useRouter } from '@/i18n/navigation';
import {
  createCustomFieldAction,
  deactivateCustomFieldAction,
  updateCustomFieldAction,
} from '@/lib/pediatric-assessment/customFields/actions';
import type { CustomFieldRow } from '@/lib/pediatric-assessment/customFields/queries';
import type { CustomFieldOption } from '@/lib/pediatric-assessment/customFields/schemas';

const TYPES = [
  'SINGLE_SELECT',
  'MULTI_SELECT',
  'TEXT',
  'LONG_TEXT',
  'SCORE_0_3',
  'NUMBER',
  'BOOLEAN',
] as const;
type FieldType = (typeof TYPES)[number];
const SELECT_TYPES: FieldType[] = ['SINGLE_SELECT', 'MULTI_SELECT'];

interface Draft {
  id?: string;
  labelEn: string;
  labelAr: string;
  type: FieldType;
  section: string;
  options: CustomFieldOption[];
}

const blank = (): Draft => ({
  labelEn: '',
  labelAr: '',
  type: 'SINGLE_SELECT',
  section: '',
  options: [],
});

export function PediatricFieldsManager({
  fields,
  locale,
}: {
  fields: CustomFieldRow[];
  locale: 'en' | 'ar';
}) {
  const t = useTranslations('pediatricAssessment.fields');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const ar = locale === 'ar';
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);

  const startEdit = (f: CustomFieldRow) =>
    setDraft({
      id: f.id,
      labelEn: f.labelEn,
      labelAr: f.labelAr,
      type: f.type as FieldType,
      section: f.section ?? '',
      options: f.options,
    });

  function save() {
    if (!draft) return;
    startTransition(async () => {
      const payload = {
        labelEn: draft.labelEn,
        labelAr: draft.labelAr,
        type: draft.type,
        section: draft.section || null,
        options: SELECT_TYPES.includes(draft.type) ? draft.options : [],
      };
      const res = draft.id
        ? await updateCustomFieldAction({ id: draft.id, ...payload })
        : await createCustomFieldAction(payload);
      if (!res.ok) {
        toast.error(ar ? res.error.message_ar : res.error.message_en);
        return;
      }
      toast.success(tCommon('saved'));
      setDraft(null);
      router.refresh();
    });
  }

  function deactivate(id: string) {
    startTransition(async () => {
      const res = await deactivateCustomFieldAction({ id });
      if (!res.ok) {
        toast.error(ar ? res.error.message_ar : res.error.message_en);
        return;
      }
      toast.success(t('deactivated'));
      router.refresh();
    });
  }

  const active = fields.filter((f) => f.active);
  const inactive = fields.filter((f) => !f.active);

  return (
    <div className="space-y-6">
      <p className="rounded-md border border-brand-border bg-brand-bg p-3 text-sm text-brand-textMuted">
        {t('coreFixedNote')}
      </p>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-brand-navy">{t('customFieldsHeading')}</h2>
        {!draft ? (
          <Button type="button" size="sm" onClick={() => setDraft(blank())} disabled={pending}>
            <Plus className="size-4" /> {t('addField')}
          </Button>
        ) : null}
      </div>

      {draft ? (
        <DraftForm
          draft={draft}
          setDraft={setDraft}
          onSave={save}
          onCancel={() => setDraft(null)}
          pending={pending}
        />
      ) : null}

      {active.length === 0 ? (
        <p className="text-sm text-brand-textMuted">{t('noCustomFields')}</p>
      ) : (
        <ul className="space-y-2">
          {active.map((f) => (
            <li
              key={f.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-border bg-brand-surface p-3"
            >
              <div>
                <p className="font-medium text-brand-navy">{ar ? f.labelAr : f.labelEn}</p>
                <p className="text-xs text-brand-textMuted">
                  {f.type}
                  {f.section ? ` · ${f.section}` : ''}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => startEdit(f)}
                  disabled={pending}
                >
                  {tCommon('edit')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => deactivate(f.id)}
                  disabled={pending}
                >
                  <Trash2 className="size-4" /> {t('deactivate')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {inactive.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-brand-textMuted">
            {t('inactiveHeading')}
          </h3>
          <ul className="space-y-1">
            {inactive.map((f) => (
              <li
                key={f.id}
                className="rounded-md border border-dashed border-brand-border p-2 text-xs text-brand-textMuted"
              >
                {ar ? f.labelAr : f.labelEn} · {f.type}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function DraftForm({
  draft,
  setDraft,
  onSave,
  onCancel,
  pending,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const t = useTranslations('pediatricAssessment.fields');
  const tCommon = useTranslations('common');
  const isSelect = SELECT_TYPES.includes(draft.type);

  const setOpt = (i: number, patch: Partial<CustomFieldOption>) =>
    setDraft({
      ...draft,
      options: draft.options.map((o, j) => (j === i ? { ...o, ...patch } : o)),
    });

  return (
    <div className="space-y-3 rounded-lg border border-brand-cyan/40 bg-brand-surface p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="f-en">{t('labelEn')}</Label>
          <Input
            id="f-en"
            value={draft.labelEn}
            onChange={(e) => setDraft({ ...draft, labelEn: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="f-ar">{t('labelAr')}</Label>
          <Input
            id="f-ar"
            value={draft.labelAr}
            onChange={(e) => setDraft({ ...draft, labelAr: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="f-type">{t('type')}</Label>
          <select
            id="f-type"
            value={draft.type}
            onChange={(e) => setDraft({ ...draft, type: e.target.value as FieldType })}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {ty}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="f-section">{t('section')}</Label>
          <Input
            id="f-section"
            value={draft.section}
            onChange={(e) => setDraft({ ...draft, section: e.target.value })}
          />
        </div>
      </div>

      {isSelect ? (
        <div className="space-y-2">
          <Label>{t('options')}</Label>
          {draft.options.map((o, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
              <Input
                placeholder={t('optValue')}
                value={o.value}
                onChange={(e) => setOpt(i, { value: e.target.value })}
              />
              <Input
                placeholder={t('optEn')}
                value={o.labelEn}
                onChange={(e) => setOpt(i, { labelEn: e.target.value })}
              />
              <Input
                placeholder={t('optAr')}
                value={o.labelAr}
                onChange={(e) => setOpt(i, { labelAr: e.target.value })}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setDraft({ ...draft, options: draft.options.filter((_, j) => j !== i) })
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setDraft({
                ...draft,
                options: [...draft.options, { value: '', labelEn: '', labelAr: '' }],
              })
            }
          >
            <Plus className="size-4" /> {t('addOption')}
          </Button>
        </div>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          {tCommon('cancel')}
        </Button>
        <Button
          type="button"
          onClick={onSave}
          disabled={pending || !draft.labelEn || !draft.labelAr}
        >
          {tCommon('save')}
        </Button>
      </div>
    </div>
  );
}
