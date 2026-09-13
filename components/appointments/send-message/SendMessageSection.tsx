'use client';

import type { UserRole } from '@prisma/client';
import { ChevronDown, Send } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { patientDisplayName } from '@/lib/format/patientName';
import { can } from '@/lib/rbac/can';
import {
  getManualMessageOptionsAction,
  sendManualAppointmentMessageAction,
  type ManualMessageOptionsDto,
} from '@/lib/whatsapp/manual/actions';
import { CUSTOM_TEXT_MAX, normalizeCustomText } from '@/lib/whatsapp/manual/customText';
import { anyRecipientReachable, type PanelRecipient } from '@/lib/whatsapp/manual/panelRecipients';
import type { ManualMessageType } from '@/lib/whatsapp/manual/types';
import { substituteTemplateBody } from '@/lib/whatsapp/templates/render';

import { SendMessageActions } from './SendMessageActions';
import { SendMessagePreview } from './SendMessagePreview';
import { SendMessageRecipients } from './SendMessageRecipients';
import { SendMessageTypePicker } from './SendMessageTypePicker';

interface Props {
  appointmentId: string;
  /** Effective viewer role — gates the whole section through `can()`
   *  (`whatsapp_manual.send`: SECRETARY + ADMIN; Act-As resolves to the
   *  effective role). The server action is the authority regardless. */
  viewerRole: UserRole;
  /**
   * P61 — everyone this appointment can message, with the phone read from the
   * SAME place as the recipient (see lib/whatsapp/manual/panelRecipients.ts).
   * The section renders whenever there is at least one; only a patient-less
   * EVENT is empty. Reading the count from the members while reading the
   * phone from the scalar relation is what produced the "no phone on file"
   * bug on single-member groups.
   */
  recipients: PanelRecipient[];
}

/**
 * P60/P61 — "Send a message" inside the appointment side panel. Collapsed by
 * default; on expand it loads the applicable types with their exact rendered
 * previews (server-composed from the same code the send uses), lets the
 * secretary pick one and — for a multi-patient session — which patients get
 * it, and sends NOW, bypassing the automatic dispatch settings and the
 * silent mode (human-initiated).
 */
export function SendMessageSection({ appointmentId, viewerRole, recipients: panel }: Props) {
  const t = useTranslations('appointments.sendMessage');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [loading, startLoad] = useTransition();
  const [sending, startSend] = useTransition();
  const [options, setOptions] = useState<ManualMessageOptionsDto | null>(null);
  const [type, setType] = useState<ManualMessageType | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [customText, setCustomText] = useState('');
  const [sentSummary, setSentSummary] = useState<string | null>(null);

  if (panel.length < 1 || !can({ id: 'viewer', role: viewerRole }, 'whatsapp_manual.send')) {
    return null;
  }
  // Not "the scalar patient has no phone" — NOBODY on the appointment has one.
  if (!anyRecipientReachable(panel)) {
    return <p className="text-xs text-brand-textMuted">{t('noPhone')}</p>;
  }

  /** Everyone the type applies to AND who can actually receive — the default
   *  selection (§1.3.2: all checked). */
  const defaultSelection = (dto: ManualMessageOptionsDto, forType: ManualMessageType | null) => {
    const opt = dto.options.find((o) => o.type === forType);
    if (!opt) return [];
    return opt.applicableRecipientIds.filter(
      (id) => dto.recipients.find((r) => r.patientId === id)?.hasPhone,
    );
  };

  const load = (keepSelection = false) =>
    startLoad(async () => {
      const r = await getManualMessageOptionsAction(appointmentId);
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      setOptions(r.data);
      const first = keepSelection
        ? (r.data.options.find((o) => o.type === type) ?? r.data.options[0])
        : r.data.options[0];
      const nextType = first?.type ?? null;
      setType(nextType);
      setSelectedIds(defaultSelection(r.data, nextType));
    });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !options) load();
  };

  const selectType = (next: ManualMessageType) => {
    setType(next);
    setSentSummary(null);
    if (options) setSelectedIds(defaultSelection(options, next));
  };

  const toggleRecipient = (patientId: string) =>
    setSelectedIds((prev) =>
      prev.includes(patientId) ? prev.filter((id) => id !== patientId) : [...prev, patientId],
    );

  const selected = options?.options.find((o) => o.type === type) ?? null;
  const recipients = options?.recipients ?? [];
  const nameOf = (patientId: string) => {
    const r = recipients.find((x) => x.patientId === patientId);
    return r ? patientDisplayName(r.fullNameEn, r.fullNameAr) : patientId;
  };
  const selectedRecipients = recipients.filter((r) => selectedIds.includes(r.patientId));
  const languages = [...new Set(selectedRecipients.map((r) => r.language))];
  /** Who among the SELECTED already received this type (per-patient guard). */
  const duplicateIds = selectedIds.filter((id) => selected?.lastSentByRecipient[id]);
  const duplicateAt =
    duplicateIds
      .map((id) => selected!.lastSentByRecipient[id]!)
      .sort()
      .at(-1) ?? null;

  const previewFor = (language: 'AR' | 'EN'): string | null => {
    if (type !== 'CUSTOM') return selected?.previewByLanguage[language] ?? null;
    const frame = options?.customFrameByLanguage[language] ?? null;
    if (!frame) return null;
    const sample = selectedRecipients.find((r) => r.language === language);
    return substituteTemplateBody(frame, [
      sample?.firstName ?? '',
      normalizeCustomText(customText),
    ]);
  };

  const normalizedLength = normalizeCustomText(customText).length;
  const overCap = normalizedLength > CUSTOM_TEXT_MAX;
  const canSend =
    Boolean(type) &&
    !sending &&
    selectedIds.length > 0 &&
    (type === 'CUSTOM'
      ? normalizedLength > 0 && !overCap
      : languages.some((l) => Boolean(previewFor(l))));

  const send = (confirmResend: boolean) =>
    startSend(async () => {
      if (!type) return;
      const r = await sendManualAppointmentMessageAction({
        appointmentId,
        type,
        customText: type === 'CUSTOM' ? customText : undefined,
        recipientIds: selectedIds,
        confirmResend,
      });
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      if (r.data.needsConfirmation) {
        // Went out between page load and click — refresh the guard and ask again.
        load(true);
        return;
      }
      const failed = r.data.results.filter((x) => !x.ok);
      setSentSummary(
        failed.length === 0
          ? t('sentAllSummary', { count: r.data.sentCount })
          : t('sentPartialSummary', {
              sent: r.data.sentCount,
              total: r.data.totalCount,
              names: failed.map((f) => nameOf(f.patientId)).join('، '),
            }),
      );
      if (failed.length > 0) {
        const first = failed[0]!.error;
        if (first) toast.error(locale === 'ar' ? first.message_ar : first.message_en);
      } else {
        toast.success(t('sentToast'));
      }
      setCustomText('');
      load(true);
    });

  return (
    <section className="rounded-md border border-brand-border bg-brand-surface">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 p-3 text-start"
      >
        <span className="inline-flex items-center gap-2 text-sm font-medium text-brand-navy">
          <Send className="size-4 text-brand-cyan" aria-hidden />
          {panel.length > 1 ? t('titleMany', { count: panel.length }) : t('title')}
        </span>
        <ChevronDown
          className={`size-4 text-brand-textMuted transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open ? (
        <div className="space-y-3 border-t border-brand-border p-3">
          {loading && !options ? (
            <p className="text-xs text-brand-textMuted">{t('loading')}</p>
          ) : null}
          {options ? (
            <>
              {recipients.every((r) => !r.hasPhone) ? (
                <p className="text-xs text-brand-textMuted">{t('noPhone')}</p>
              ) : null}
              <SendMessageTypePicker
                options={options.options}
                selected={type}
                onSelect={selectType}
                customApproved={recipients.every(
                  (r) => options.customApprovedByLanguage[r.language],
                )}
              />
              {type && recipients.length > 1 ? (
                <SendMessageRecipients
                  recipients={recipients}
                  applicableIds={selected?.applicableRecipientIds ?? []}
                  selectedIds={selectedIds}
                  onToggle={toggleRecipient}
                  lastSentByRecipient={selected?.lastSentByRecipient ?? {}}
                />
              ) : null}
              {type === 'CUSTOM' ? (
                <div className="space-y-1">
                  <textarea
                    value={customText}
                    onChange={(e) => {
                      setCustomText(e.target.value);
                      setSentSummary(null);
                    }}
                    rows={4}
                    dir={languages[0] === 'EN' ? 'ltr' : 'rtl'}
                    placeholder={t('customPlaceholder')}
                    aria-label={t('types.CUSTOM')}
                    className="w-full rounded-md border border-brand-border bg-brand-surface px-3 py-2 text-sm text-brand-text placeholder:text-brand-textMuted focus:outline-none focus:ring-2 focus:ring-brand-cyan"
                  />
                  <p
                    className={`text-xs ${overCap ? 'text-destructive' : 'text-brand-textMuted'}`}
                    aria-live="polite"
                  >
                    {t('customHint', { max: CUSTOM_TEXT_MAX })} ·{' '}
                    {t('customCount', { count: normalizedLength, max: CUSTOM_TEXT_MAX })}
                  </p>
                </div>
              ) : null}
              {type
                ? languages.map((language) => (
                    <SendMessagePreview
                      key={language}
                      text={previewFor(language)}
                      language={language}
                      recipientCount={
                        selectedRecipients.filter((r) => r.language === language).length
                      }
                    />
                  ))
                : null}
              {sentSummary ? (
                <p className="text-xs text-brand-teal" aria-live="polite">
                  {sentSummary}
                </p>
              ) : null}
              {type ? (
                <SendMessageActions
                  duplicateAt={duplicateAt}
                  duplicateNames={recipients.length > 1 ? duplicateIds.map((id) => nameOf(id)) : []}
                  sendCount={selectedIds.length}
                  sentAt={null}
                  sending={sending}
                  disabled={!canSend}
                  onSend={send}
                />
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
