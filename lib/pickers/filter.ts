/**
 * Picker search filtering (Prompt 47) — the pure matching logic behind every
 * searchable patient/clinician dropdown, extracted so the privacy and
 * bilingual rules are unit-tested once and shared by all surfaces.
 *
 * PRIVACY (Prompt 15): matching runs ONLY over the fields a surface passes
 * in. Surfaces where the viewer may not see phone numbers simply never pass
 * them — there is no phone-aware logic to get wrong here.
 */

export interface PickerOption {
  id: string;
  /** Primary label in the viewer's locale. */
  label: string;
  /** Secondary line — typically the other-script name (+ phone where the
   *  viewer is allowed to see it). Searched too, so AR queries match rows
   *  labeled in EN and vice versa. */
  sublabel?: string | null;
  /** Search-only terms that are NEVER rendered (P47 row 8 — the Arabic name
   *  disappeared from display but typed-Arabic matching must keep working,
   *  same asymmetry as the kiosk: match yes, display no). */
  searchTerms?: ReadonlyArray<string>;
  disabled?: boolean;
}

/** Case-insensitive, whitespace-trimmed containment across all fields. */
export function matchesPickerQuery(
  query: string,
  ...fields: Array<string | null | undefined>
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => (f ?? '').toLowerCase().includes(q));
}

/** Single-select list: options matching the query (label, sublabel, or the
 *  hidden search-only terms). */
export function filterPickerOptions(options: PickerOption[], query: string): PickerOption[] {
  return options.filter((o) =>
    matchesPickerQuery(query, o.label, o.sublabel, ...(o.searchTerms ?? [])),
  );
}

/**
 * Multi-select pill walls (P20 therapists, P30 group members): SELECTED
 * options are always visible regardless of the query — filtering must never
 * hide or drop an active selection — while unselected ones filter normally.
 */
export function partitionPillOptions(
  options: PickerOption[],
  selectedIds: ReadonlyArray<string>,
  query: string,
): { selected: PickerOption[]; unselectedMatches: PickerOption[] } {
  const sel = new Set(selectedIds);
  return {
    selected: options.filter((o) => sel.has(o.id)),
    unselectedMatches: options.filter(
      (o) =>
        !sel.has(o.id) && matchesPickerQuery(query, o.label, o.sublabel, ...(o.searchTerms ?? [])),
    ),
  };
}
