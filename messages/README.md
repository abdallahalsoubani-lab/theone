# `messages/`

i18n catalogs. **Implemented in Prompt 3**.

Source of truth: `en.json` and `ar.json` — same set of dotted key paths in both
files. CI enforces parity via [`scripts/check-i18n-sync.ts`](../scripts/check-i18n-sync.ts)
(run locally with `pnpm i18n:check`, wired into
[`.github/workflows/sync-check.yml`](../.github/workflows/sync-check.yml) and the
main quality pipeline).

See [`docs/i18n/README.md`](../docs/i18n/README.md) for the full conventions:
namespace organisation, ICU MessageFormat usage, RTL rules, and the translation
policy (no invented clinical terminology — confirm with the clinic team).
