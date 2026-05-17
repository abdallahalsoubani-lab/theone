'use client';

import type { CustomQuestionAppliesTo } from '@prisma/client';
import { GripVertical, MoreHorizontal } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Link } from '@/i18n/navigation';
import {
  deactivateCustomQuestionAction,
  deleteCustomQuestionAction,
  reorderCustomQuestionsAction,
} from '@/lib/admin/custom-questions/actions';
import type { CustomQuestionRow } from '@/lib/admin/custom-questions/queries';

interface Props {
  initialScope: CustomQuestionAppliesTo;
  adult: CustomQuestionRow[];
  pediatric: CustomQuestionRow[];
}

export function QuestionsBoard({ initialScope, adult, pediatric }: Props) {
  const t = useTranslations('admin.customQuestions');
  return (
    <Tabs defaultValue={initialScope === 'PEDIATRIC' ? 'PEDIATRIC' : 'ADULT'}>
      <TabsList>
        <TabsTrigger value="ADULT">{t('adultTab')}</TabsTrigger>
        <TabsTrigger value="PEDIATRIC">{t('pediatricTab')}</TabsTrigger>
      </TabsList>
      <TabsContent value="ADULT">
        <QuestionsList rows={adult} />
      </TabsContent>
      <TabsContent value="PEDIATRIC">
        <QuestionsList rows={pediatric} />
      </TabsContent>
    </Tabs>
  );
}

function QuestionsList({ rows }: { rows: CustomQuestionRow[] }) {
  const t = useTranslations('admin.customQuestions');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [order, setOrder] = useState<CustomQuestionRow[]>(rows);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <p className="text-sm text-brand-textMuted">{t('noQuestions')}</p>
          <Button asChild className="mt-4">
            <Link href="/admin/intake-questions/new">{t('newQuestion')}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const persistOrder = (next: CustomQuestionRow[]) => {
    setOrder(next);
    startTransition(async () => {
      const r = await reorderCustomQuestionsAction({ orderedIds: next.map((q) => q.id) });
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        setOrder(rows); // revert
        return;
      }
      toast.success(t('reorderedToast'));
    });
  };

  const onDragStart = (id: string) => setDraggedId(id);
  const onDragOver = (e: React.DragEvent) => e.preventDefault();
  const onDrop = (targetId: string) => {
    if (!draggedId || draggedId === targetId) return;
    const from = order.findIndex((q) => q.id === draggedId);
    const to = order.findIndex((q) => q.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    setDraggedId(null);
    persistOrder(next);
  };

  const handleDeactivate = (id: string) =>
    startTransition(async () => {
      const r = await deactivateCustomQuestionAction(id);
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(t('deactivatedToast'));
      router.refresh();
    });

  const handleDelete = (id: string) =>
    startTransition(async () => {
      const r = await deleteCustomQuestionAction(id);
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(t('deletedToast'));
      router.refresh();
    });

  return (
    <ul
      className={`divide-y divide-brand-border overflow-hidden rounded-md border border-brand-border bg-brand-surface ${
        pending ? 'opacity-60' : ''
      }`}
    >
      {order.map((q) => (
        <li
          key={q.id}
          draggable
          onDragStart={() => onDragStart(q.id)}
          onDragOver={onDragOver}
          onDrop={() => onDrop(q.id)}
          className="flex items-center gap-3 p-3 hover:bg-brand-bg"
        >
          <button
            type="button"
            className="cursor-grab text-brand-textMuted active:cursor-grabbing"
            aria-label={t('displayOrder')}
          >
            <GripVertical className="size-4" />
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-brand-navy">
                {locale === 'ar' ? q.nameAr : q.nameEn}
              </span>
              {q.required ? <Badge variant="cyan">★</Badge> : null}
              {!q.active ? <Badge variant="muted">{tCommon('no')}</Badge> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-brand-textMuted">
              <Badge variant="muted">{t(`type${pascal(q.type)}`)}</Badge>
              <Badge variant="muted">{t(`applies${pascal(q.appliesTo)}`)}</Badge>
              {q.answerCount > 0 ? (
                <span>
                  · {q.answerCount} {tCommon('search') /* answers — close enough */}
                </span>
              ) : null}
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="actions">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/admin/intake-questions/${q.id}/edit`}>{tCommon('edit')}</Link>
              </DropdownMenuItem>
              {q.active ? (
                <DropdownMenuItem onSelect={() => handleDeactivate(q.id)}>
                  {t('deactivatedToast').replace('.', '')}
                </DropdownMenuItem>
              ) : null}
              {q.answerCount === 0 ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <ConfirmDialog
                      title={tCommon('delete')}
                      description={t('cannotDeleteInUse', { count: 0 })}
                      variant="destructive"
                      onConfirm={() => handleDelete(q.id)}
                      trigger={
                        <div className="w-full cursor-pointer text-start text-sm text-destructive">
                          {tCommon('delete')}
                        </div>
                      }
                    />
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </li>
      ))}
    </ul>
  );
}

function pascal<T extends string>(s: T): string {
  return s
    .toLowerCase()
    .split('_')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}
