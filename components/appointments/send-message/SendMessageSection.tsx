'use client';

import type { UserRole } from '@prisma/client';
import { ChevronDown, Send } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { can } from '@/lib/rbac/can';
import {
  getManualMessageOptionsAction,
  sendManualAppointmentMessageAction,
  type ManualMessageOptionsDto,
} from '@/lib/whatsapp/manual/actions';
import { normalizeCustomText } from '@/lib/whatsapp/manual/customText';
import type { ManualMessageType } from '@/lib/whatsapp/manual/types';
import { substituteTemplateBody } from '@/lib/whatsapp/templates/render';

import { SendMessageActions } from './SendMessageActions';
import { SendMessagePreview } from './SendMessagePreview';
import { SendMessageTypePicker } from './SendMessageTypePicker';

interface Props {
  appointmentId: string;
  /** Effective viewer role — gates the whole section through `can()`
   *  (`whatsapp_manual.send`: SECRETARY + ADMIN; Act-As resolves to the
   *  effective role). The server action is the authority regardless. */
  viewerRole: UserRole;
  /** False for EVENT/GROUP (no scalar patient) — the section is not rendered. */
  hasPatient: boolean;
  hasPhone: boolean;
}

/**
 * P60 — "Send a message to the patient" inside the appointment side panel.
 * Collapsed by default; on expand it loads the applicable types with their
 * exact rendered previews (server-composed from the same code the send
 * uses), lets the secretary pick one, and sends NOW — bypassing the
 * automatic dispatch settings and the silent mode (human-initiated).
 */
export function SendMessageSection({ appointmentId, viewerRole, hasPatient, hasPhone }: Props) {
  const t = useTranslations('appointments.sendMessage');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [loading, startLoad] = useTransition();
  const [sending, startSend] = useTransition();
  const [options, setOptions] = useState<ManualMessageOptionsDto | null>(null);
  const [type, setType] = useState<ManualMessageType | null>(null);
  const [customText, setCustomText] = useState('');
  const [duplicateAt, setDuplicateAt] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<string | null>(null);

  if (!hasPatient || !can({ id: 'viewer', role: viewerRole }, 'whatsapp_manual.send')) {
    return null;
  }
  if (!hasPhone) {
    return <p className="text-xs text-brand-textMuted">{t('noPhone')}</p>;
  }

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
      setType(first?.type ?? null);
      setDuplicateAt(first?.lastSentAt ?? null);
    });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !options) load();
  };

  const selectType = (next: ManualMessageType) => {
    setType(next);
    setSentAt(null);
    setDuplicateAt(options?.options.find((o) => o.type === next)?.lastSentAt ?? null);
  };

  const send = (confirmResend: boolean) =>
    startSend(async () => {
      if (!type) return;
      const r = await sendManualAppointmentMessageAction({
        appointmentId,
        type,
        customText: type === 'CUSTOM' ? customText : undefined,
        confirmResend,
      });
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      if (r.data.needsConfirmation) {
        // Went out between page load and click — surface the time, ask again.
        setDuplicateAt(r.data.lastSentAt);
        return;
      }
      setSentAt(r.data.sentAt);
      setDuplicateAt(r.data.sentAt);
      setCustomText('');
      toast.success(t('sentToast'));
      load(true);
    });

  const selected = options?.options.find((o) => o.type === type) ?? null;
  const previewText =
    type === 'CUSTOM'
      ? options?.customFrame
        ? substituteTemplateBody(options.customFrame, [
            options.patientFirstName,
            normalizeCustomText(customText),
          ])
        : null
      : (selected?.preview ?? null);
  const canSend =
    Boolean(type) &&
    !sending &&
    (type === 'CUSTOM' ? normalizeCustomText(customText).length > 0 : Boolean(previewText));

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
          {t('title')}
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
              <SendMessageTypePicker
                options={options.options}
                selected={type}
                onSelect={selectType}
                customApproved={options.customApproved}
              />
              {type ? (
                <SendMessagePreview
                  type={type}
                  text={previewText}
                  language={options.language}
                  customText={customText}
                  onCustomTextChange={(v) => {
                    setCustomText(v);
                    setSentAt(null);
                  }}
                />
              ) : null}
              {type ? (
                <SendMessageActions
                  duplicateAt={duplicateAt}
                  sentAt={sentAt}
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
