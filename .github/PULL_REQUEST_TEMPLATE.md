<!--
PR template — see Prompt 0 §8.4 for the working protocol.

One PR per build prompt. Reference the prompt number in the title, e.g.:
  feat: Prompt 2 — database schema and initial migration
-->

## What was built

<!--
Concrete summary of the changes in this PR.
- bullet 1
- bullet 2
- bullet 3
Link to the prompt under docs/prompts/ that this PR closes.
-->

## What was deferred and why

<!--
Anything in the prompt that was *not* implemented, with a one-line justification.
"Out of scope" deferrals (e.g. owned by a later prompt) are fine — just record them so
the project owner does not have to spot them by diffing the prompt against this PR.
Write "None." if everything in the prompt is in the PR.
-->

## What the project owner should manually test

<!--
Acceptance criteria that require human eyes (visual regression, RTL behavior, drag
interactions, real WhatsApp delivery, etc.). Include the exact URLs, credentials, and
steps. Pair each step with the expected outcome.
-->

## Checklist

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build` all pass locally
- [ ] `pnpm test` passes (if tests were added or affected)
- [ ] `messages/en.json` and `messages/ar.json` are in sync (once Prompt 3 has landed)
- [ ] README and module-level READMEs updated if scripts, env vars, modules, or migrations changed
- [ ] Screenshots attached below for any new UI surface
- [ ] Commit messages follow Conventional Commits
