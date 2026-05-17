# Internationalization (i18n) & RTL

Owner: **Prompt 3**. Implementation lives in `i18n/`, `middleware.ts`, `messages/`,
`components/shell/`, `lib/format/`, and `scripts/check-i18n-sync.ts`.

## Locales and defaults

| Setting           | Value                                    | Reasoning                                                 |
| ----------------- | ---------------------------------------- | --------------------------------------------------------- |
| Supported locales | `en`, `ar`                               | Clinic operates in both languages                         |
| Default locale    | `ar`                                     | Clinic is in Jordan; primary user base is Arabic-speaking |
| URL strategy      | `always-prefixed` (`/en/...`, `/ar/...`) | Bare `/` 307-redirects to the resolved locale             |
| Cookie name       | `NEXT_LOCALE`                            | next-intl default; matches Prompt 3 §4.7                  |

## Locale detection chain (fresh visitor)

1. **URL segment** — `/en/...` or `/ar/...` wins, always.
2. **`NEXT_LOCALE` cookie** — set by the [language toggle](../../components/shell/LanguageToggle.tsx). 1-year `Max-Age`, `SameSite=Lax`, `Path=/`.
3. **`Accept-Language` header** — for first-time visitors with no cookie.
4. **`routing.defaultLocale`** — `ar`.

Verified end-to-end with `curl`:

```bash
# fresh visitor                 → /ar
curl -sI http://localhost:3000/
# en Accept-Language            → /en
curl -sI -H 'Accept-Language: en-US' http://localhost:3000/
# cookie wins over Accept-Lang  → /ar
curl -sI -H 'Accept-Language: en-US' -b 'NEXT_LOCALE=ar' http://localhost:3000/
```

## Message catalogs

`messages/en.json` and `messages/ar.json`. Organized by namespace; each major
area gets one top-level object. Current namespaces:

- `common` — universal verbs and chrome ("Save", "Cancel", "Loading…")
- `navigation` — nav-related labels and aria-labels
- `shell` — header / footer copy
- `footer` — clinic identity, links, copyright
- `errors` — `notFound` and `generic` recovery pages
- `landing` — Phase 0 landing
- `styleGuide` — internal style guide section titles

Add new namespaces (`auth`, `appointments`, `intake`, …) as features arrive.

### Conventions

- **camelCase keys** (`languageToggle`, not `language-toggle`).
- **Sentence case in English** ("Sign in", not "Sign In"). Matches Prompt 0 §4.2.
- **No punctuation in keys** — keys are identifiers, not sentences.
- **Interpolation** uses ICU MessageFormat: `"copyright": "© {year} {name}. {rights}"`.
- **Pluralization** — use `{count, plural, one {...} other {...}}` when adding count-aware strings.

### Workflow for adding a new key

1. Add the key with a real English value to `messages/en.json`.
2. Add the corresponding entry to `messages/ar.json` — **never commit a stub** like
   `"FIXME"`. The job of catalogs is to be correct in both languages at all times.
3. Run `pnpm i18n:check` — must report sync. CI fails the build otherwise.
4. Use it from a component: `const t = useTranslations('namespace'); t('key')` (client)
   or `const t = await getTranslations('namespace')` (server).

### Translation policy

Shell strings are easy: there's one obvious correct rendering. **Anything
clinically-loaded** (diagnoses, treatment-plan terminology, SOAP-note labels)
must be confirmed with the clinic team before landing — do not invent Arabic
medical terminology. The Arabic side of Prompt 3 contains only shell copy for
that reason.

## RTL handling

- `<html lang>` and `<html dir>` are set in `app/[locale]/layout.tsx` from the
  resolved locale.
- Body font is swapped per locale: `font-sans` (Inter) for `en`, `font-arabic`
  (IBM Plex Sans Arabic) for `ar`. Verify in DevTools — both fonts load via
  `next/font` so the swap is zero-flash.
- **Always use logical CSS classes**: `ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`,
  `end-*`, `border-s`, `border-e`. Never `ml-*` / `mr-*` for layout. RTL must
  work without per-component overrides. Prompt 0 §5 rule 3 is a hard rule.
- **Direction-sensitive icons** (chevrons, arrows): use
  [`DirectionalIcon`](../../components/ui/DirectionalIcon.tsx) with a semantic
  name (`chevron-end`, `chevron-start`, `arrow-end`, `arrow-start`) — never
  `ChevronRight` / `ArrowLeft` etc. directly. The component flips via
  `rtl:-scale-x-100` so the same JSX renders correctly in both directions.

### Testing RTL

Open `/ar/style-guide` and look for:

- Cut-off text at line wraps
- Icons that point the wrong way (the DirectionalIcon rule should prevent this)
- Sidebars / drawers anchored to the wrong edge (Sheet `side="start"` / `"end"`
  is direction-aware; `"left"` / `"right"` should never appear)
- Scrollbars on the wrong side
- Margin / padding asymmetry that "looks fine" only in LTR
- Mixed-direction strings (phone numbers in Arabic prose) — should be wrapped
  with LRM markers via `formatPhone` (see below)

Then visit `/en/style-guide` side-by-side and confirm parity. The
**Bilingual preview** card on the style guide renders both directions in one
view for quick visual diff.

## Formatting helpers

`lib/format/` has three modules:

| File        | What it does                                                                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `date.ts`   | `formatDate`, `formatShortDate`, `formatTime`, `formatDateTime`, `formatRelative` — all `Intl.DateTimeFormat`-backed; accept `calendar: 'gregory' \| 'islamic-umalqura'` for Hijri |
| `number.ts` | `formatNumber(value, locale, options?)` — wraps `Intl.NumberFormat`                                                                                                                |
| `phone.ts`  | `formatPhone(input)` — normalises Jordan numbers and LRM-wraps                                                                                                                     |

Both locales use **Latin digits** (`1234567890`) per Prompt 3 §3 — Arabic-Indic
display is explicitly out of scope. The single switch is in
[`lib/format/locale.ts`](../../lib/format/locale.ts) (`LATIN_NUMBERING`); change
`numberingSystem: 'latn'` to `'arab'` to flip every formatter at once if the
clinic later asks.

### Phone numbers and Unicode LRM markers

`formatPhone` wraps its output in `‎` characters (U+200E LEFT-TO-RIGHT MARK).
Without them, a `+962 79 …` string embedded in Arabic prose has the `+`
swallowed into the RTL run and the digits jumble visually. The LRM markers
force an LTR isolate so the number stays readable. **Always render patient or
clinic phone numbers via `formatPhone`** — never raw.

### Hijri calendar

Pass `calendar: 'islamic-umalqura'` to `formatDate` / `formatShortDate` /
`formatDateTime`. The underlying ISO timestamp is unchanged — only the
formatted output differs. The user-level preference (toggling Hijri in the
profile) is added by Prompt 5; feature code can opt in immediately once a
preference is available.

## shadcn/ui RTL caveats

Discovered during Prompt 3 and patched in this repo:

- **Sheet (drawer):** the default shadcn variants are named `left` / `right`,
  which break under RTL. This repo's [`Sheet`](../../components/ui/sheet.tsx)
  uses `start` / `end` variants with logical `inset-y-0 start-0` /
  `inset-y-0 end-0` positioning. Slide animations include both
  `slide-in-from-{left,right}` and the `rtl:slide-in-from-{right,left}`
  variants so the drawer flies in from the inline-start edge in both
  directions.
- **Dialog:** the close button is positioned with `end-4 top-4` (logical),
  not `right-4`, so it stays in the inline-end corner under RTL.

No other shadcn primitives needed patching as of Prompt 3.
