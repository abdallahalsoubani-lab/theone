# Performance budget

Per Prompt 11 §4.9. The CI gate is **200 kB gzipped first-load JS
for any single route**. Configured in `package.json` → `size-limit`.

## Why 200 kB

That's the median budget for a snappy first paint on a mid-range
Android device over 4G — the actual conditions a patient in Amman
likely sits in. Well-loved consumer apps hit this; an internal
clinic app has fewer excuses.

## Run locally

```bash
pnpm build
pnpm size-limit
```

The output lists each chunk and its size against the budget. CI
fails the build when any chunk exceeds it.

## Common offenders

- **react-big-calendar** — drags ~70 kB. Used only on the secretary
  calendar page; lazy-load with `next/dynamic` so other pages don't
  pay. (Currently OK; revisit if total grows past budget.)
- **@react-pdf/renderer** — heavy. Lives in the API route handler
  (server-side); never ships to the client. Don't accidentally
  import it from a client component.
- **recharts** — moderate. Used only on dashboards; the per-page
  cost is acceptable but watch for additional widgets.
- **Translations** — `messages/{en,ar}.json` are 1000+ keys. They
  load on the server and only the namespace each page needs is
  serialized to the client. Don't import the whole catalog.

## Backlog

- Add `@next/bundle-analyzer` as a dev dep + a `pnpm analyze` script
  so contributors can see per-chunk breakdowns when their PR pushes
  the budget.
