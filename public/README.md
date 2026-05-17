# `/public` — static assets

## Logo files

| File | Variant | Viewbox | Intended background |
|---|---|---|---|
| `logo.svg` | icon | `0 0 80 80` (square) | **Light** (`#FFFFFF`, brand surface) |
| `logo-dark.svg` | icon | `0 0 80 80` (square) | **Dark** (brand navy `#0B1E47` or photographic) |
| `logo-wordmark.svg` | wordmark | `0 0 240 60` (4:1) | Light backgrounds; pairs the mark with the "Theone.pt" type lockup |

The three SVGs currently committed are **placeholders** generated for Phase 0. They use the
locked brand palette so the rest of the system can render correctly, but they are not the
production identity.

## Swapping in the production logo

When the project owner supplies the final logo files:

1. **Keep the filenames exactly**: `logo.svg`, `logo-dark.svg`, `logo-wordmark.svg`. Anything
   else changes import paths across the app and breaks favicons / Open Graph cards.
2. **Match the viewBox dimensions** above. If the production asset has different proportions,
   ask before merging — the calendar header, login screen, and PDF exports assume square or 4:1
   aspect ratios.
3. **Must remain SVG.** PNG/JPG break crisp rendering at high DPI and inflate the page weight.
   If only raster assets are supplied, run them through a vectorizer first or generate an SVG
   wrapper that embeds the raster.
4. **Both backgrounds must work.** `logo.svg` should be legible on `#FFFFFF` and on
   `#F2F4F8` (page background). `logo-dark.svg` should be legible on `#0B1E47` (brand navy).
5. **Inline `<title>`** with the brand name for accessibility; the React `<Logo>` wrapper in
   `components/brand/Logo.tsx` already adds `alt`, but inline titles help non-React consumers
   (PDF exports, email previews).
6. **No embedded raster, no external font references.** Both inflate the file and bind the SVG
   to remote resources that may not be reachable.
7. **Run the visual diff** of `/style-guide` before and after the swap; the page renders all
   three variants for review.

After replacing the files, no further code changes are required — `<Logo>` and every page
that references it pick up the new SVG on the next page load.
