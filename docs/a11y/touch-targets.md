# Touch-target audit

Per Prompt 11 §4.7.4. Minimum touch target: **44×44 px** (WCAG 2.5.5
Level AAA, but treated as AA expectation for mobile-first apps).

## Automated check

`tests/e2e/mobile/touch-targets.spec.ts` (scaffolded) iterates every
`button, a, [role="button"], input, select` on each critical-path
page at the 375 px viewport and asserts the bounding box meets the
threshold.

## Deliberate exceptions

| Element                                  | Size   | Reason                                                                                          |
| ---------------------------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| Calendar event chip (single appointment) | varies | Calendar density requirement; the side-panel click target is the appointment row, not the chip. |
| Patient compliance day-dot (12×12 px)    | 12×12  | Status indicator only; not interactive. Aria-labelled but not focusable.                        |

Add any new exception here with rationale; the CI test reads this
file to allow-list known cases.
