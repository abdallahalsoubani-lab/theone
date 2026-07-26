'use client';

import type { UserRole } from '@prisma/client';
import { Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

import { ThreadPane, type LinkablePatient } from '@/components/whatsapp-inbox/ThreadPane';
import { Badge } from '@/components/ui/badge';
import { formatPhone } from '@/lib/format/phone';
import { formatTime } from '@/lib/format/date';
import { patientDisplayName } from '@/lib/format/patientName';
import type { ConversationListRow, ThreadView } from '@/lib/whatsapp/inbox/queries';
import { cn } from '@/lib/utils';

/** Poll cadence — the arrivals-panel precedent (P18). */
const REFRESH_MS = 12_000;

const FILTERS = ['all', 'unread', 'unknown'] as const;

export function InboxShell({
  conversations,
  thread,
  filter,
  search,
  viewerRole,
  patients,
}: {
  conversations: ConversationListRow[];
  thread: ThreadView | null;
  filter: (typeof FILTERS)[number];
  search: string;
  viewerRole: UserRole;
  patients: LinkablePatient[];
}) {
  const t = useTranslations('waInbox');
  const locale = useLocale();
  const intlLocale: 'en' | 'ar' = locale === 'ar' ? 'ar' : 'en';
  const router = useRouter();
  const params = useSearchParams();

  // Soft polling keeps the list + open thread + badge current (P18 pattern).
  useEffect(() => {
    const id = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [router]);

  const setParam = (next: Record<string, string | undefined>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (!v) p.delete(k);
      else p.set(k, v);
    }
    router.replace(`?${p.toString()}`);
  };

  const rowName = (c: ConversationListRow) =>
    c.patientId
      ? patientDisplayName(c.patientFullNameEn ?? '', c.patientFullNameAr ?? '', locale)
      : t('unknownNumber');

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[minmax(280px,1fr)_2fr]">
      <aside className="flex min-h-0 flex-col rounded-md border border-brand-border bg-brand-surface">
        <div className="space-y-2 border-b border-brand-border p-2">
          <div className="flex items-center gap-2 rounded-md border border-brand-border bg-brand-bg px-2">
            <Search className="size-3.5 flex-none text-brand-textMuted" aria-hidden />
            <input
              type="text"
              defaultValue={search}
              onChange={(e) => setParam({ q: e.target.value || undefined })}
              placeholder={t('searchPlaceholder')}
              className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-brand-textMuted"
            />
          </div>
          <div className="flex gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setParam({ f: f === 'all' ? undefined : f })}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium',
                  filter === f
                    ? 'bg-brand-cyan text-white'
                    : 'bg-brand-bg text-brand-navy hover:bg-brand-cyan/10',
                )}
              >
                {t(`filter_${f}`)}
              </button>
            ))}
          </div>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <li className="p-4 text-center text-sm text-brand-textMuted">{t('emptyList')}</li>
          ) : (
            conversations.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setParam({ c: c.id })}
                  className={cn(
                    'flex w-full flex-col gap-0.5 border-b border-brand-border px-3 py-2 text-start hover:bg-brand-bg',
                    thread?.conversation.id === c.id && 'bg-brand-cyan/5',
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        'truncate text-sm',
                        c.unread ? 'font-semibold text-brand-navy' : 'text-brand-text',
                      )}
                    >
                      {rowName(c)}
                    </span>
                    <span className="flex-none text-[10px] tabular-nums text-brand-textMuted">
                      {formatTime(c.lastMessageAt, intlLocale)}
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    {c.unread ? (
                      <span className="size-2 flex-none rounded-full bg-brand-cyan" />
                    ) : null}
                    {!c.patientId ? (
                      <Badge variant="outline" className="px-1 py-0 text-[9px]">
                        {t('unknownBadge')}
                      </Badge>
                    ) : null}
                    <span className="truncate text-xs text-brand-textMuted" dir="auto">
                      {c.lastSnippetFallbackTemplate !== null
                        ? `${t('templateGeneric')}: ${c.lastSnippetFallbackTemplate}`
                        : c.lastSnippet || '—'}
                    </span>
                  </span>
                  <span className="font-mono text-[10px] text-brand-textMuted" dir="ltr">
                    &lrm;{formatPhone(c.phone)}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </aside>

      <main className="flex min-h-0 flex-col rounded-md border border-brand-border bg-brand-surface">
        {thread ? (
          <ThreadPane thread={thread} viewerRole={viewerRole} patients={patients} />
        ) : (
          <p className="m-auto p-8 text-center text-sm text-brand-textMuted">{t('pickThread')}</p>
        )}
      </main>
    </div>
  );
}
