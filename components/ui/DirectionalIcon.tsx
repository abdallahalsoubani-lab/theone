import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, type LucideProps } from 'lucide-react';
import type { ComponentType } from 'react';

import { cn } from '@/lib/utils';

/**
 * Direction-aware Lucide icon wrapper.
 *
 * Rule (Prompt 3 §4.8): never use ChevronRight / ChevronLeft / ArrowRight /
 * ArrowLeft directly in shell or feature code. Use this component with a
 * semantic name instead:
 *
 *   `chevron-end`  — points toward the inline-end (right in LTR, left in RTL)
 *   `chevron-start` — points toward the inline-start (left in LTR, right in RTL)
 *   `arrow-end`    — same semantics for an arrow
 *   `arrow-start`
 *
 * Implementation: the LTR-correct Lucide icon is rendered, then mirrored under
 * RTL via `rtl:-scale-x-100`. This keeps icon names readable in LTR-thinking
 * design tools while staying correct in Arabic.
 */
export type DirectionalIconName = 'chevron-end' | 'chevron-start' | 'arrow-end' | 'arrow-start';

const ICONS: Record<DirectionalIconName, ComponentType<LucideProps>> = {
  'chevron-end': ChevronRight,
  'chevron-start': ChevronLeft,
  'arrow-end': ArrowRight,
  'arrow-start': ArrowLeft,
};

interface DirectionalIconProps extends Omit<LucideProps, 'ref'> {
  name: DirectionalIconName;
}

export function DirectionalIcon({ name, className, ...props }: DirectionalIconProps) {
  const Icon = ICONS[name];
  return <Icon className={cn('rtl:-scale-x-100', className)} aria-hidden {...props} />;
}
