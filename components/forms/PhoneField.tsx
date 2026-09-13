'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { formatPatientPhone } from '@/lib/format/phone';

/**
 * P61 item 2 §2.3.2 — the phone input with a country selector.
 *
 * Jordan is selected by default and a bare `07…` still submits exactly as it
 * always did, so the secretary's flow is unchanged; a US or Gulf number is two
 * clicks away. A value pasted with its own `+` / `00` prefix is passed through
 * untouched, so copy-pasting a full international number keeps working.
 *
 * NO phone metadata is loaded here: the dial codes below are a static table
 * and country-level validity is decided on the server
 * (lib/format/phone-validate.ts). Bundling `libphonenumber-js` into a client
 * component would add ~150 kB to the first-load budget, which has ~20 kB of
 * headroom.
 *
 * The bilingual country names follow the same in-code-table pattern as the
 * cancellation-category labels in lib/whatsapp/templates/sendCancelled.ts.
 */

interface CountryOption {
  /** Calling code without the plus. */
  dial: string;
  en: string;
  ar: string;
}

/** Jordan first, then the countries this clinic's patients actually carry. */
export const PHONE_COUNTRIES: CountryOption[] = [
  { dial: '962', en: 'Jordan', ar: 'الأردن' },
  { dial: '966', en: 'Saudi Arabia', ar: 'السعودية' },
  { dial: '971', en: 'United Arab Emirates', ar: 'الإمارات' },
  { dial: '965', en: 'Kuwait', ar: 'الكويت' },
  { dial: '974', en: 'Qatar', ar: 'قطر' },
  { dial: '973', en: 'Bahrain', ar: 'البحرين' },
  { dial: '968', en: 'Oman', ar: 'عُمان' },
  { dial: '970', en: 'Palestine', ar: 'فلسطين' },
  { dial: '972', en: 'Israel', ar: 'إسرائيل' },
  { dial: '961', en: 'Lebanon', ar: 'لبنان' },
  { dial: '963', en: 'Syria', ar: 'سوريا' },
  { dial: '964', en: 'Iraq', ar: 'العراق' },
  { dial: '20', en: 'Egypt', ar: 'مصر' },
  { dial: '1', en: 'United States / Canada', ar: 'الولايات المتحدة / كندا' },
  { dial: '44', en: 'United Kingdom', ar: 'المملكة المتحدة' },
  { dial: '49', en: 'Germany', ar: 'ألمانيا' },
  { dial: '33', en: 'France', ar: 'فرنسا' },
  { dial: '46', en: 'Sweden', ar: 'السويد' },
  { dial: '61', en: 'Australia', ar: 'أستراليا' },
  { dial: '90', en: 'Turkey', ar: 'تركيا' },
];

const DEFAULT_DIAL = '962';
/** Longest dial codes first so «+9627…» resolves to 962, not 9. */
const BY_LENGTH = [...PHONE_COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);

/** Split a stored E.164 value back into (country, national) for editing. */
export function splitStoredPhone(value: string | null | undefined): {
  dial: string;
  national: string;
} {
  const raw = (value ?? '').trim();
  if (!raw.startsWith('+')) return { dial: DEFAULT_DIAL, national: raw };
  const digits = raw.slice(1).replace(/\D+/g, '');
  const match = BY_LENGTH.find((c) => digits.startsWith(c.dial));
  return match
    ? { dial: match.dial, national: digits.slice(match.dial.length) }
    : { dial: DEFAULT_DIAL, national: raw };
}

/**
 * Compose what the form submits. A value the user typed with its own
 * international prefix wins; otherwise the selected country's code is put in
 * front of the national number (its trunk `0` dropped).
 */
export function composePhone(dial: string, national: string): string {
  const typed = national.trim();
  if (typed === '') return '';
  if (typed.startsWith('+') || typed.startsWith('00')) return typed;
  const digits = typed.replace(/\D+/g, '').replace(/^0+/, '');
  return digits ? `+${dial}${digits}` : '';
}

interface Props<T extends FieldValues> {
  form: UseFormReturn<T>;
  name: Path<T>;
  label: string;
  description?: string;
  disabled?: boolean;
  className?: string;
}

export function PhoneField<T extends FieldValues>({
  form,
  name,
  label,
  description,
  disabled,
  className,
}: Props<T>) {
  const t = useTranslations('common.phoneField');
  const locale = useLocale();
  const isAr = locale === 'ar';
  const initial = splitStoredPhone(form.getValues(name) as string | undefined);
  const [dial, setDial] = useState(initial.dial);
  const [national, setNational] = useState(initial.national);

  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => {
        const composed = composePhone(dial, national);
        const update = (nextDial: string, nextNational: string) => {
          setDial(nextDial);
          setNational(nextNational);
          field.onChange(composePhone(nextDial, nextNational));
        };
        return (
          <FormItem className={className}>
            <FormLabel>{label}</FormLabel>
            <div className="flex gap-2">
              <FormControl>
                <select
                  value={dial}
                  disabled={disabled}
                  aria-label={t('countryLabel')}
                  onChange={(e) => update(e.target.value, national)}
                  className="h-10 w-32 shrink-0 rounded-md border border-brand-border bg-brand-surface px-2 text-sm text-brand-text focus:outline-none focus:ring-2 focus:ring-brand-cyan"
                >
                  {PHONE_COUNTRIES.map((c) => (
                    <option key={`${c.dial}-${c.en}`} value={c.dial}>
                      {isAr ? c.ar : c.en} +{c.dial}
                    </option>
                  ))}
                </select>
              </FormControl>
              <FormControl>
                <Input
                  type="tel"
                  inputMode="tel"
                  dir="ltr"
                  disabled={disabled}
                  placeholder={t('numberPlaceholder')}
                  value={national}
                  onChange={(e) => update(dial, e.target.value)}
                />
              </FormControl>
            </div>
            {composed ? (
              <FormDescription>
                {t('willBeSavedAs', { phone: formatPatientPhone(composed, isAr ? 'ar' : 'en') })}
              </FormDescription>
            ) : null}
            {description ? <FormDescription>{description}</FormDescription> : null}
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}
