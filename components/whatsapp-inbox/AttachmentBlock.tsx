'use client';

import { AlertCircle, FileText, ImageIcon, Music, Play, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { ThreadAttachment } from '@/lib/whatsapp/inbox/queries';

const attachmentUrl = (id: string) => `/api/v1/whatsapp/attachments/${id}`;

function humanSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * P56 — inbound media in the inbox. Nothing loads until the user clicks
 * (owner decision 3): the resting state is a lightweight placeholder (icon +
 * type + size). On click, the byte stream is fetched from the gated route —
 * image inline, video via a streaming <video>, document in a new tab. Failed
 * and retention-expired attachments render a clear terminal state.
 */
export function AttachmentBlock({ attachments }: { attachments: ThreadAttachment[] }) {
  const t = useTranslations('waInbox.attachment');
  const [opened, setOpened] = useState<Set<string>>(new Set());

  if (attachments.length === 0) return null;

  const open = (id: string) => setOpened((prev) => new Set(prev).add(id));

  return (
    <div className="mb-1 space-y-2">
      {attachments.map((a) => {
        const size = humanSize(a.sizeBytes);
        const meta = [t(`kind.${a.kind}`), size].filter(Boolean).join(' · ');

        if (a.status === 'EXPIRED') {
          return (
            <div
              key={a.id}
              className="flex items-center gap-2 rounded-md border border-brand-border bg-brand-bg px-2.5 py-2 text-xs text-brand-textMuted"
            >
              <Trash2 className="size-4 shrink-0" aria-hidden />
              <span>{t('expired')}</span>
            </div>
          );
        }
        if (a.status === 'FAILED') {
          return (
            <div
              key={a.id}
              className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs text-destructive"
            >
              <AlertCircle className="size-4 shrink-0" aria-hidden />
              <span>{t('failed')}</span>
            </div>
          );
        }
        if (a.status === 'PENDING') {
          return (
            <div
              key={a.id}
              className="flex items-center gap-2 rounded-md border border-brand-border bg-brand-bg px-2.5 py-2 text-xs text-brand-textMuted"
            >
              <ImageIcon className="size-4 shrink-0" aria-hidden />
              <span>{t('downloading', { meta })}</span>
            </div>
          );
        }

        // STORED — interactive, but bytes fetch only after the click.
        const isOpen = opened.has(a.id);
        if (a.kind === 'image') {
          return isOpen ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={a.id}
              src={attachmentUrl(a.id)}
              alt={a.filename ?? t('kind.image')}
              loading="lazy"
              className="max-h-72 w-auto max-w-full rounded-md border border-brand-border"
            />
          ) : (
            <Placeholder
              key={a.id}
              icon={<ImageIcon className="size-4" />}
              label={t('viewImage')}
              meta={meta}
              onClick={() => open(a.id)}
            />
          );
        }
        if (a.kind === 'video') {
          return isOpen ? (
            <video
              key={a.id}
              src={attachmentUrl(a.id)}
              controls
              preload="none"
              className="max-h-72 w-auto max-w-full rounded-md border border-brand-border"
            />
          ) : (
            <Placeholder
              key={a.id}
              icon={<Play className="size-4" />}
              label={t('playVideo')}
              meta={meta}
              onClick={() => open(a.id)}
            />
          );
        }
        // audio / document → open in a new tab (only on click).
        const icon =
          a.kind === 'audio' ? <Music className="size-4" /> : <FileText className="size-4" />;
        return (
          <a
            key={a.id}
            href={attachmentUrl(a.id)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-md border border-brand-border bg-brand-surface px-2.5 py-2 text-xs font-medium text-brand-navy transition hover:border-brand-cyan"
          >
            {icon}
            <span className="truncate">{a.filename ?? t(`kind.${a.kind}`)}</span>
            {size ? <span className="ms-auto text-brand-textMuted">{size}</span> : null}
          </a>
        );
      })}
    </div>
  );
}

function Placeholder({
  icon,
  label,
  meta,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md border border-brand-border bg-brand-surface px-2.5 py-2 text-start text-xs font-medium text-brand-navy transition hover:border-brand-cyan"
    >
      <span className="text-brand-blue">{icon}</span>
      <span>{label}</span>
      {meta ? <span className="ms-auto text-brand-textMuted">{meta}</span> : null}
    </button>
  );
}
