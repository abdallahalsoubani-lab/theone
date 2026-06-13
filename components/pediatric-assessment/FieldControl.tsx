'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type FieldKind =
  | 'DATE'
  | 'TEXT'
  | 'LONG_TEXT'
  | 'SINGLE_SELECT'
  | 'MULTI_SELECT'
  | 'SCORE_0_3'
  | 'NUMBER'
  | 'BOOLEAN';

export interface FieldDescriptor {
  id: string;
  kind: FieldKind;
  label: string;
  /** Localized option labels keyed by the stored (English) value. */
  options?: { value: string; label: string }[];
  required?: boolean;
}

interface Props {
  field: FieldDescriptor;
  value: unknown;
  onChange: (value: unknown) => void;
  yesLabel: string;
  noLabel: string;
}

const SCORES = [0, 1, 2, 3];

/**
 * One pediatric-assessment field, rendered by kind (Prompt 21 §5). Selects are
 * segmented buttons; SCORE_0_3 is a compact score row. The STORED value is the
 * English option string; only the label is localized.
 */
export function FieldControl({ field, value, onChange, yesLabel, noLabel }: Props) {
  const id = `pa-${field.id}`;

  return (
    <div className="space-y-1">
      <Label htmlFor={id}>
        {field.label}
        {field.required ? <span className="text-red-600"> *</span> : null}
      </Label>

      {field.kind === 'LONG_TEXT' ? (
        <textarea
          id={id}
          rows={3}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      ) : field.kind === 'TEXT' || field.kind === 'NUMBER' || field.kind === 'DATE' ? (
        <Input
          id={id}
          type={field.kind === 'NUMBER' ? 'number' : field.kind === 'DATE' ? 'date' : 'text'}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.kind === 'BOOLEAN' ? (
        <div className="flex gap-1.5">
          {[
            { v: true, l: yesLabel },
            { v: false, l: noLabel },
          ].map((o) => (
            <Segment
              key={String(o.v)}
              selected={value === o.v}
              label={o.l}
              onClick={() => onChange(o.v)}
            />
          ))}
        </div>
      ) : field.kind === 'SCORE_0_3' ? (
        <div className="flex gap-1.5">
          {SCORES.map((s) => (
            <Segment key={s} selected={value === s} label={String(s)} onClick={() => onChange(s)} />
          ))}
        </div>
      ) : field.kind === 'SINGLE_SELECT' ? (
        <div className="flex flex-wrap gap-1.5">
          {(field.options ?? []).map((o) => (
            <Segment
              key={o.value}
              selected={value === o.value}
              label={o.label}
              onClick={() => onChange(value === o.value ? undefined : o.value)}
            />
          ))}
        </div>
      ) : (
        // MULTI_SELECT
        <div className="flex flex-wrap gap-1.5">
          {(field.options ?? []).map((o) => {
            const arr = Array.isArray(value) ? (value as string[]) : [];
            const selected = arr.includes(o.value);
            return (
              <Segment
                key={o.value}
                selected={selected}
                label={o.label}
                onClick={() =>
                  onChange(selected ? arr.filter((x) => x !== o.value) : [...arr, o.value])
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function Segment({
  selected,
  label,
  onClick,
}: {
  selected: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
        selected
          ? 'border-brand-cyan bg-brand-cyan text-white'
          : 'border-brand-border bg-brand-bg text-brand-navy hover:border-brand-cyan'
      }`}
    >
      {label}
    </button>
  );
}
